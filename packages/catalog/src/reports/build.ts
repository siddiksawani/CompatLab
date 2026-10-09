import { randomUUID } from "node:crypto";
import {
  assertionEvidenceSchema,
  CLASSIFIER_REVISION,
  type HostedReport,
  hostedReportSchema,
  MAX_REPORT_BYTES,
  type NormalizedFailure,
  probeGroupResultSchema,
  probePlanSchema,
} from "@compatlab/contracts";
import {
  assertionDefinition,
  classifyAssertion,
  classifyCell,
  classifyDiagnostic,
  combineOutcomes,
  failureOutcome,
  optionalPeerContext,
  sanitizeJson,
} from "@compatlab/engine";
import { eq } from "drizzle-orm";
import { probeRevisions } from "../assertions/schema.js";
import type { CatalogTransaction } from "../database.js";
import {
  jobs,
  matrices,
  matrixMembers,
  packages,
  packageVersions,
  preparations,
  runs,
  runtimeImages,
  scans,
} from "../schema.js";

export async function buildReport(
  tx: CatalogTransaction,
  scanId: string,
  now: Date,
): Promise<HostedReport> {
  const [row] = await tx
    .select({
      scan: scans,
      prep: preparations,
      artifact: packageVersions,
      name: packages.name,
      matrix: matrices,
    })
    .from(scans)
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .innerJoin(packageVersions, eq(packageVersions.id, preparations.artifactId))
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .innerJoin(matrices, eq(matrices.id, scans.matrixId))
    .where(eq(scans.id, scanId));
  if (!row || ["requested", "preparing", "running"].includes(row.scan.state))
    throw new TypeError("The scan has no finalized evidence to classify.");
  const images = await tx
    .select({ id: runtimeImages.id, definition: runtimeImages.definition })
    .from(matrixMembers)
    .innerJoin(runtimeImages, eq(runtimeImages.id, matrixMembers.imageId))
    .where(eq(matrixMembers.matrixId, row.matrix.id))
    .orderBy(matrixMembers.position);
  const evidence = await tx
    .select({ run: runs, job: jobs })
    .from(runs)
    .innerJoin(jobs, eq(jobs.runId, runs.id))
    .where(eq(runs.scanId, scanId));
  const terminalReasons = {
    cancelled: "job_cancelled",
    inconclusive: "coverage_limit_exceeded",
    rejected: "service_policy_rejected",
    failed_infrastructure: "runner_unavailable",
  } as const;
  const reason =
    row.scan.aggregationFailedAt && row.scan.state === "failed_infrastructure"
      ? undefined
      : terminalReasons[row.scan.state as keyof typeof terminalReasons];
  const terminalFailure = reason ? classifyDiagnostic(null, reason) : null;
  const preparationFailure =
    row.scan.diagnostics?.phase === "static_analysis"
      ? classifyDiagnostic(row.scan.diagnostics)
      : row.prep.state === "ready"
        ? null
        : row.prep.diagnostics
          ? classifyDiagnostic(row.prep.diagnostics)
          : (terminalFailure ?? classifyDiagnostic(null));
  const metadata = record(row.prep.metadata);
  const optionalPeers = optionalPeerContext(
    row.name,
    row.prep.installedManifest,
    metadata.installed,
  );
  const cells: HostedReport["cells"] = [];
  for (const image of images)
    for (const group of ["root", "subpaths"] as const)
      for (const mode of ["esm", "commonjs"] as const) {
        const runtime = row.scan.plan?.runtimes.find(
          (runtime) => runtime.profileId === image.definition.profileId,
        );
        const entries = runtime
          ? (group === "root" ? [runtime.root] : runtime.entries)
              .filter((entry) => entry[mode].applicable)
              .map((entry) => entry.specifier)
          : null;
        const stored = evidence.find(
          (item) =>
            item.run.assertionRevisionId === null &&
            item.run.imageId === image.id &&
            item.run.probeGroup === group &&
            item.run.mode === mode,
        );
        const raw = stored?.run.rawEvidence
          ? probeGroupResultSchema.parse(stored.run.rawEvidence)
          : null;
        const failure: NormalizedFailure | null =
          preparationFailure ??
          (raw ? null : (terminalFailure ?? classifyDiagnostic(stored?.job.attemptSummary)));
        cells.push(
          classifyCell({
            runId: stored?.run.id ?? null,
            profileId: image.definition.profileId,
            group,
            mode,
            entries,
            evidence: raw,
            failure,
            optionalPeers,
          }),
        );
      }
  const omissions = row.scan.plan
    ? probePlanSchema.shape.omissions.parse(row.scan.plan.omissions)
    : null;
  const omittedCoverage = omissions
    ? omissions.counts.pattern + omissions.counts.invalid_subpath + omissions.counts.coverage_limit
    : 0;
  const combined = combineOutcomes(cells.map((cell) => cell.outcome));
  const outcome = terminalFailure
    ? failureOutcome(terminalFailure)
    : omittedCoverage > 0 && combined !== "infrastructure_error"
      ? "inconclusive"
      : combined;
  const prep = row.prep;
  const snapshot =
    prep.snapshotId &&
    prep.snapshotGeneration &&
    prep.lockDigest &&
    prep.treeDigest &&
    prep.installerImage
      ? {
          id: prep.snapshotId,
          generation: prep.snapshotGeneration,
          lockDigest: prep.lockDigest,
          treeDigest: prep.treeDigest,
          profileRevision: prep.profileRevision,
          installerImage: prep.installerImage,
        }
      : null;
  const report: HostedReport = {
    schemaVersion: 1,
    id: randomUUID(),
    scanId,
    classifierRevision: CLASSIFIER_REVISION,
    observedAt: row.scan.evidenceCompletedAt?.toISOString() ?? null,
    classifiedAt: now.toISOString(),
    artifact: {
      name: row.name,
      version: row.artifact.version,
      integrity: row.artifact.integrity,
      tarballUrl: row.artifact.tarballUrl,
    },
    preparation: {
      id: prep.id,
      outcome: preparationFailure ? failureOutcome(preparationFailure) : "pass",
      failure: preparationFailure,
      profileRevision: prep.profileRevision,
      snapshot,
      installedCount: Array.isArray(metadata.installed) ? metadata.installed.length : 0,
      omittedOptionalCount: Array.isArray(metadata.omittedOptional)
        ? metadata.omittedOptional.length
        : 0,
      staticObservations: record(sanitizeJson(metadata.staticObservations)),
    },
    matrix: {
      id: row.matrix.id,
      revision: row.matrix.revision,
      platform: "linux_amd64_glibc",
      harnessRevision: row.matrix.harnessRevision,
      planRevision: row.matrix.planRevision,
      policyRevision: row.matrix.policyRevision,
      images: images.map((image) => image.definition),
    },
    omissions,
    cells,
    outcome,
    evidenceLevel: cells.some((cell) => cell.evidenceLevel === "smoke_tested")
      ? "smoke_tested"
      : "static_only",
    coverageComplete:
      !terminalFailure &&
      !preparationFailure &&
      omittedCoverage === 0 &&
      cells.every((cell) => cell.coverage.complete),
    limitations: [
      "Only installation and loading were observed; functional correctness and package safety are not established.",
      "Subpath batches share module caches and globals; root modes use separate fresh sandboxes.",
      "Package-visible harness observations can be tampered with. They are not adversarial attestation.",
      "Evidence applies to these exact artifacts, dependency snapshot, runtime images and Linux amd64/glibc policy.",
      "Runtime error codes are captured observations and can also be thrown by package code.",
    ],
  };
  if (row.scan.assertionRevisionId) {
    const [revision] = await tx
      .select()
      .from(probeRevisions)
      .where(eq(probeRevisions.id, row.scan.assertionRevisionId));
    if (!revision) throw new Error("Assertion revision missing.");
    report.assertions = [
      {
        definition: assertionDefinition(revision.bundle),
        cells: images.map((image) => {
          const stored = evidence.find(
            (item) => item.run.imageId === image.id && item.run.assertionRevisionId === revision.id,
          );
          return classifyAssertion(
            image.definition.profileId,
            stored?.run.id ?? null,
            stored?.run.rawEvidence ? assertionEvidenceSchema.parse(stored.run.rawEvidence) : null,
            preparationFailure ?? terminalFailure ?? classifyDiagnostic(stored?.job.attemptSummary),
          );
        }),
      },
    ];
    report.limitations.push(
      "Named assertions are separate observations. Their failures may originate in the probe or package, and only their stated behavior was tested.",
    );
  }
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES)
    throw new TypeError("Normalized report exceeds its evidence budget.");
  return hostedReportSchema.parse(report);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
