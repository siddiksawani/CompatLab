import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  infrastructureFailureSchema,
  type JobResult,
  jobEvidenceBudget,
  PREPARATION_INSTALLER_IMAGE,
  type ProbeGroupResult,
  parseBoundedJson,
  parseProbeCheckpoint,
  preparationClassificationSchema,
  submissionSchema,
} from "@compatlab/contracts";
import { parseInstalledManifest, validateLock } from "@compatlab/engine";
import { eq, sql } from "drizzle-orm";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { allowedSelection } from "../policy.js";
import {
  jobs,
  matrices,
  packages,
  packageVersions,
  preparations,
  runs,
  runtimeImages,
  scans,
} from "../schema.js";
import { currentAttempt } from "./claims.js";
import { advanceScan } from "./reconcile.js";
import { activeWorker, authenticatedWorker, databaseNow, SchedulingError } from "./workers.js";

export async function submitJobResult(db: CatalogDatabase, token: string, rawSubmission: unknown) {
  const submission = submissionSchema.parse(rawSubmission);
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(submission.result)))
    .digest("hex");
  return catalogTransaction(db, async (tx) => {
    const worker = await authenticatedWorker(tx, token);
    const now = await databaseNow(tx);
    const row = await currentAttempt(tx, worker.id, submission, now, true);
    if (row.job.resultDigest) {
      if (row.job.resultDigest !== digest)
        throw new SchedulingError(
          "invalid_result",
          "This attempt already accepted different evidence.",
        );
      return { accepted: true, duplicate: true };
    }
    await activeWorker(tx, token, submission.sessionId);
    if (!(await allowedSelection(tx, row.preparation.artifactId, row.scan.matrixId)))
      throw new SchedulingError("stale_attempt", "Execution policy no longer permits this result.");
    const result = submission.result;
    if (result.kind === "failure") await acceptFailure(tx, row, result, now, digest);
    else {
      if (result.kind !== row.job.kind)
        throw new SchedulingError("invalid_result", "Result kind differs from the job.");
      if (result.kind === "preparation") await acceptPreparation(tx, row.preparation, result);
      else await acceptRun(tx, row, result.evidence, now);
      await tx
        .update(jobs)
        .set({
          state: "finished",
          resultDigest: digest,
          attemptSummary: { outcome: "accepted" },
          leaseExpiresAt: null,
        })
        .where(eq(jobs.id, row.job.id));
    }
    const dependents = await tx
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.preparationId, row.preparation.id));
    for (const scan of dependents) await advanceScan(tx, scan.id, now);
    await tx
      .update(scans)
      .set({ progressRevision: sql`${scans.progressRevision}+1` })
      .where(eq(scans.id, row.scan.id));
    return { accepted: true, duplicate: false };
  });
}
type AttemptRow = Awaited<ReturnType<typeof currentAttempt>>;
async function acceptFailure(
  tx: CatalogTransaction,
  row: AttemptRow,
  failure: Extract<JobResult, { kind: "failure" }>,
  now: Date,
  digest: string,
) {
  if (failure.origin === "preparation") {
    if (
      row.job.kind !== "preparation" ||
      !preparationClassificationSchema.safeParse(failure.classification).success
    )
      throw new SchedulingError("invalid_result", "Invalid preparation failure.");
  } else if (!infrastructureFailureSchema.safeParse(failure.classification).success)
    throw new SchedulingError("invalid_result", "Invalid infrastructure failure.");
  const retry =
    failure.origin === "infrastructure" &&
    row.job.attempt < 3 &&
    (row.job.deadlineAt?.getTime() ?? 0) > now.getTime() + 5000 * row.job.attempt;
  await tx
    .update(jobs)
    .set({
      state: retry ? "queued" : "finished",
      availableAt: new Date(now.getTime() + 5000 * row.job.attempt),
      resultDigest: digest,
      leaseExpiresAt: null,
      attemptSummary: { ...failure, retry },
    })
    .where(eq(jobs.id, row.job.id));
  if (row.job.kind === "preparation" && !retry)
    await tx
      .update(preparations)
      .set({
        state: failure.origin === "infrastructure" ? "failed_infrastructure" : "rejected",
        diagnostics: failure,
      })
      .where(eq(preparations.id, row.preparation.id));
}
async function acceptPreparation(
  tx: CatalogTransaction,
  prep: typeof preparations.$inferSelect,
  result: Extract<JobResult, { kind: "preparation" }>,
) {
  const [artifact] = await tx
    .select({
      name: packages.name,
      version: packageVersions.version,
      integrity: packageVersions.integrity,
      tarballUrl: packageVersions.tarballUrl,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(eq(packageVersions.id, prep.artifactId));
  if (!artifact) throw new Error("Preparation artifact missing.");
  const lock = Buffer.from(result.lockBase64, "base64");
  if (
    lock.toString("base64") !== result.lockBase64 ||
    validateLock(lock, artifact).digest !== result.snapshot.lockDigest ||
    result.snapshot.profileRevision !== prep.profileRevision ||
    result.snapshot.installerImage !== PREPARATION_INSTALLER_IMAGE
  )
    throw new SchedulingError(
      "invalid_result",
      "Preparation provenance differs from the reserved inputs.",
    );
  const manifest = parseInstalledManifest(Buffer.from(result.manifestJson), artifact);
  const metadata = {
    staticObservations: result.staticObservations,
    installed: result.installed,
    omittedOptional: result.omittedOptional,
  };
  parseBoundedJson(Buffer.from(JSON.stringify(metadata)), 4 * 1024 ** 2);
  await tx
    .update(preparations)
    .set({
      state: "ready",
      lockBytes: lock,
      lockDigest: result.snapshot.lockDigest,
      snapshotId: result.snapshot.id,
      snapshotGeneration: result.snapshot.generation,
      treeDigest: result.snapshot.treeDigest,
      installerImage: result.snapshot.installerImage,
      installedManifest: manifest,
      metadata,
      snapshotAvailable: true,
    })
    .where(eq(preparations.id, prep.id));
}
async function acceptRun(
  tx: CatalogTransaction,
  row: AttemptRow,
  evidence: ProbeGroupResult,
  now: Date,
) {
  if (!row.job.runId || !row.scan.plan)
    throw new SchedulingError("invalid_result", "Run inputs are unavailable.");
  const [run] = await tx
    .select({ run: runs, profileId: runtimeImages.profileId, runtimeCount: matrices.runtimeCount })
    .from(runs)
    .innerJoin(runtimeImages, eq(runtimeImages.id, runs.imageId))
    .innerJoin(matrices, eq(matrices.id, runs.matrixId))
    .where(eq(runs.id, row.job.runId));
  if (!run) throw new Error("Run identity missing.");
  const plan = row.scan.plan.runtimes.find((candidate) => candidate.profileId === run.profileId);
  if (!plan) throw new SchedulingError("invalid_result", "Run profile differs from the plan.");
  const entries = (run.run.probeGroup === "root" ? [plan.root] : plan.entries)
    .filter((entry) => entry[run.run.mode].applicable)
    .map((entry) => entry.specifier);
  if (
    evidence.profileId !== run.profileId ||
    evidence.group !== run.run.probeGroup ||
    evidence.mode !== run.run.mode ||
    evidence.method !== (evidence.group === "root" ? "fresh_root_v2" : "sequential_batch_v2") ||
    !isDeepStrictEqual(entries, evidence.entries)
  )
    throw new SchedulingError("invalid_result", "Run evidence differs from the immutable plan.");
  const bytes = Buffer.from(JSON.stringify(evidence));
  const budget = jobEvidenceBudget(row.scan.plan, row.preparation.metadata, run.runtimeCount);
  parseBoundedJson(bytes, budget.maxEvidenceBytes);
  verifyEvidence(evidence);
  const logs = evidence.sessions.map((session) => ({ probeId: session.probeId, ...session.logs }));
  if (
    logs.reduce(
      (sum, log) => sum + Buffer.byteLength(log.stdout) + Buffer.byteLength(log.stderr),
      0,
    ) > budget.maxLogBytes
  )
    throw new SchedulingError("invalid_result", "Run logs exceed their scan budget.");
  const rawEvidence = {
    ...evidence,
    sessions: evidence.sessions.map((session) => ({
      ...session,
      logs: { ...session.logs, stdout: "", stderr: "" },
    })),
  };
  await tx
    .update(runs)
    .set({
      rawEvidence: storableText(rawEvidence),
      logs: { sessions: storableText(logs), sanitization: "nul_replacement_v1" },
      logsExpireAt: new Date(now.getTime() + 30 * 86400_000),
    })
    .where(eq(runs.id, run.run.id));
}
export function verifyEvidence(evidence: ProbeGroupResult): void {
  const observations: ProbeGroupResult["observations"] = [];
  const interruptions: ProbeGroupResult["interruptions"] = [];
  let next = 0;
  for (const [position, session] of evidence.sessions.entries()) {
    if (
      session.startIndex !== next ||
      next >= evidence.entries.length ||
      (evidence.group === "root" && position > 0)
    )
      throw new SchedulingError("invalid_result", "Probe continuation is inconsistent.");
    if (session.checkpoint) {
      parseProbeCheckpoint(Buffer.from(JSON.stringify(session.checkpoint)), {
        schemaVersion: 2,
        probeId: session.probeId,
        group: evidence.group,
        mode: evidence.mode,
        entries: evidence.entries,
        startIndex: session.startIndex,
      });
      observations.push(...session.checkpoint.observations);
    }
    if (session.stopReason === "completed") {
      if (
        session.exitCode !== 0 ||
        session.oomKilled ||
        !session.checkpoint?.completed ||
        position !== evidence.sessions.length - 1
      )
        throw new SchedulingError(
          "invalid_result",
          "Completion lacks a valid successful process outcome.",
        );
      next = evidence.entries.length;
    } else {
      const index = session.checkpoint?.activeIndex ?? null;
      interruptions.push({ index, reason: session.stopReason });
      const resumable =
        index !== null &&
        [
          "entry_timeout",
          "batch_timeout",
          "unexpected_process_exit",
          "memory_limit_exceeded",
          "output_limit_exceeded",
        ].includes(session.stopReason);
      if (!resumable && position !== evidence.sessions.length - 1)
        throw new SchedulingError("invalid_result", "This session cannot be continued.");
      next = resumable ? index + 1 : evidence.entries.length;
    }
  }
  const interrupted = interruptions.filter((item) => item.index !== null).length;
  const coverage = {
    planned: evidence.entries.length,
    observed: observations.length,
    interrupted,
    untested: evidence.entries.length - observations.length - interrupted,
    complete:
      observations.length === evidence.entries.length &&
      interruptions.length === 0 &&
      (evidence.entries.length === 0 || evidence.sessions.at(-1)?.stopReason === "completed"),
  };
  if (
    !isDeepStrictEqual(observations, evidence.observations) ||
    !isDeepStrictEqual(interruptions, evidence.interruptions) ||
    !isDeepStrictEqual(coverage, evidence.coverage)
  )
    throw new SchedulingError("invalid_result", "Evidence summary differs from its checkpoints.");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

function storableText<T>(value: T): T {
  // PostgreSQL jsonb cannot represent U+0000.
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string" ? item.replaceAll("\u0000", "?") : item,
    ),
  ) as T;
}
