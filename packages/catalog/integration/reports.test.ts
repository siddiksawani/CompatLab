import { randomUUID } from "node:crypto";
import {
  CLASSIFIER_REVISION,
  type JobAssignment,
  PREPARATION_PROFILE_REVISION,
  type ProbeGroupResult,
  parseReproductionInputs,
  reportSummaryEnvelopeSchema,
} from "@compatlab/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  admitScan,
  aggregatePendingReports,
  claimJob,
  createReportApi,
  discoverCompatibility,
  discoverRecentReports,
  discoverReportPreviews,
  invalidateReport,
  migrateCatalog,
  quarantineRuntime,
  readReport,
  readReportLogs,
  readyWorker,
  reclassifyScan,
  reconcileCatalog,
  registerMatrix,
  registerWorker,
  scanProgress,
  schema,
  submitJobResult,
} from "../src/index.js";
import { prepared, runEvidence } from "./execution-fixtures.js";
import {
  actor,
  admitted,
  artifact,
  concurrent,
  database,
  image,
  matrix,
  options,
  seedMatrix,
} from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let selection: Awaited<ReturnType<typeof seedMatrix>>;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => {
  await catalog?.dispose();
});
beforeEach(async () => {
  await catalog.pool.query(
    "TRUNCATE audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  selection = await seedMatrix(catalog.db);
});
async function execution(
  settings: {
    name?: string;
    matrixId?: string;
    manifest?: Record<string, unknown>;
    failure?: string;
    mutate?: (job: Extract<JobAssignment, { kind: "run" }>, evidence: ProbeGroupResult) => void;
  } = {},
) {
  const owner = await registerWorker(
    catalog.db,
    {
      platform: "linux_amd64_glibc",
      preparationProfiles: [PREPARATION_PROFILE_REVISION],
      imageDigests: [0, 1, 2, 3].map((index) => image(index).imageId),
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
    },
    3,
    actor,
  );
  const sessionId = randomUUID();
  await readyWorker(catalog.db, owner.token, { sessionId, snapshotIds: [] });
  const source = artifact(settings.name ?? "@scope/report-fixture");
  const scan = admitted(
    await admitScan(catalog.db, source, options(settings.matrixId ?? selection.matrixId)),
  );
  const job = await claimJob(catalog.db, owner.token, { sessionId });
  if (!job) throw new Error("Fixture preparation job missing.");
  const result = prepared(job);
  if (settings.manifest)
    result.manifestJson = JSON.stringify({
      name: source.name,
      version: source.version,
      ...settings.manifest,
    });
  await submitJobResult(catalog.db, owner.token, {
    sessionId,
    jobId: job.jobId,
    attemptToken: job.attemptToken,
    result: settings.failure
      ? {
          kind: "failure",
          origin: "preparation",
          classification: settings.failure,
          message: "Authored prerequisite failure.",
        }
      : result,
  });
  for (;;) {
    const run = await claimJob(catalog.db, owner.token, { sessionId });
    if (!run) break;
    if (run.kind !== "run") throw new Error("Unexpected fixture job.");
    const evidence = runEvidence(run);
    settings.mutate?.(run, evidence);
    await submitJobResult(catalog.db, owner.token, {
      sessionId,
      jobId: run.jobId,
      attemptToken: run.attemptToken,
      result: { kind: "run", evidence },
    });
  }
  return { scan, source, result };
}
async function aggregate(scanId: string) {
  expect(await aggregatePendingReports(catalog.db)).toEqual({ completed: 1, failed: 0 });
  const progress = await scanProgress(catalog.db, scanId);
  if (!progress?.reportId) throw new Error("Expected classified report.");
  const envelope = await readReport(catalog.db, progress.reportId);
  if (!envelope) throw new Error("Expected stored report.");
  return envelope;
}
describe("immutable report classification", () => {
  it("uses retained preparation metadata to explain optional peers without changing raw observations", async () => {
    const { scan } = await execution({
      manifest: {
        exports: { ".": "./index.js", "./util": "./util.js", "./server": "./server.js" },
        peerDependencies: { renderer: "^2" },
        peerDependenciesMeta: { renderer: { optional: true } },
      },
      mutate(job, evidence) {
        if (job.group !== "subpaths") return;
        evidence.observations[1] = {
          index: 1,
          outcome: "fail",
          durationMs: 1,
          resolvedTo: null,
          error: {
            name: "Error",
            code: "MODULE_NOT_FOUND",
            message: "Cannot find module 'renderer'",
          },
        };
      },
    });
    const raw = await catalog.db.select().from(schema.runs);
    const prep = await catalog.db.select().from(schema.preparations);
    const jobs = await catalog.db.select().from(schema.jobs);
    const { report } = await aggregate(scan.scanId);
    expect(report).toMatchObject({ outcome: "inconclusive", coverageComplete: true });
    const subpaths = report.cells.filter((cell) => cell.group === "subpaths");
    expect(subpaths).toHaveLength(8);
    for (const cell of subpaths) {
      expect(cell).toMatchObject({
        outcome: "inconclusive",
        coverage: { observed: 2, passed: 1, failed: 1, prerequisiteLimited: 1, complete: true },
        failure: {
          classification: "optional_peer_missing",
          origin: "prerequisite",
          optionalPeer: { name: "renderer", range: "^2" },
        },
      });
      expect(cell.entries[1]?.outcome).toBe("inconclusive");
    }
    expect(
      report.cells.filter((cell) => cell.group === "root").every((cell) => cell.outcome === "pass"),
    ).toBe(true);
    expect(await catalog.db.select().from(schema.runs)).toEqual(raw);
    expect(await catalog.db.select().from(schema.preparations)).toEqual(prep);
    expect((await catalog.db.select().from(schema.jobs)).map((job) => job.id).sort()).toEqual(
      jobs.map((job) => job.id).sort(),
    );
    const [preview] = await discoverReportPreviews(catalog.db, [report.artifact.name]);
    expect(
      (await discoverCompatibility(catalog.db, selection.matrixId, { failureRuntime: "bun" }))
        .entries,
    ).toEqual([]);
    expect(
      preview?.cells.find((cell) => cell.group === "subpaths")?.coverage.prerequisiteLimited,
    ).toBe(1);
  });
  it("serves bounded previews from current evidence and withdraws invalidated or quarantined results", async () => {
    const first = await execution({ name: "preview-fixture" });
    const { report } = await aggregate(first.scan.scanId);
    const counts = (await catalog.pool.query("SELECT count(*) FROM jobs")).rows;
    const [preview] = await discoverReportPreviews(catalog.db, [
      "missing-fixture",
      first.source.name,
    ]);
    expect(preview).toMatchObject({
      id: report.id,
      artifact: { name: first.source.name, version: first.source.version },
      matrix: report.matrix,
      outcome: report.outcome,
      coverageComplete: report.coverageComplete,
    });
    expect(preview?.cells).toEqual(
      report.cells.map(({ profileId, group, mode, outcome, coverage }) => ({
        profileId,
        group,
        mode,
        outcome,
        coverage,
      })),
    );
    expect(JSON.stringify(preview)).not.toContain('"entries"');
    expect(JSON.stringify(preview)).not.toContain('"staticObservations"');
    expect(await discoverRecentReports(catalog.db)).toEqual([
      {
        id: report.id,
        name: first.source.name,
        version: first.source.version,
        outcome: report.outcome,
      },
    ]);
    expect((await catalog.pool.query("SELECT count(*) FROM jobs")).rows).toEqual(counts);
    const replacement = await reclassifyScan(catalog.db, first.scan.scanId, actor);
    expect(
      (await discoverReportPreviews(catalog.db, [first.source.name])).map((item) => item.id),
    ).toEqual([replacement]);
    await invalidateReport(catalog.db, replacement, actor);
    expect(await discoverReportPreviews(catalog.db, [first.source.name])).toEqual([]);
    expect(await discoverRecentReports(catalog.db)).toEqual([]);
    const second = await execution({ name: "quarantined-preview-fixture" });
    await aggregate(second.scan.scanId);
    await quarantineRuntime(catalog.db, selection.imageIds[0] ?? "", actor);
    expect(await discoverReportPreviews(catalog.db, [second.source.name])).toEqual([]);
    expect(await discoverRecentReports(catalog.db)).toEqual([]);
    await expect(
      discoverReportPreviews(catalog.db, Array(4).fill(first.source.name)),
    ).rejects.toThrow();
  });
  it("paginates eligible baseline reports without work or retained raw entries", async () => {
    for (const name of ["@scope/directory-one", "directory-two", "directory-three"]) {
      const { scan } = await execution({ name });
      await aggregate(scan.scanId);
    }
    const counts = (await catalog.pool.query("SELECT count(*) FROM jobs")).rows;
    const first = await discoverCompatibility(catalog.db, selection.matrixId, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.entries.every((entry) => entry.matchesCurrentMatrix)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('"staticObservations"');
    expect(JSON.stringify(first.entries[0]?.report)).not.toContain('"entries"');
    if (!first.next) throw new Error("Expected continuation");
    const second = await discoverCompatibility(catalog.db, selection.matrixId, {
      after: first.next,
      limit: 2,
    });
    expect(second.entries).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(
      new Set([...first.entries, ...second.entries].map((entry) => entry.artifactId)).size,
    ).toBe(3);
    expect(
      (await discoverCompatibility(catalog.db, selection.matrixId, { after: randomUUID() }))
        .entries,
    ).toEqual([]);
    const firstId = first.entries[0]?.report.id;
    if (!firstId) throw new Error("Missing report");
    await invalidateReport(catalog.db, firstId, actor);
    expect((await discoverCompatibility(catalog.db, selection.matrixId)).entries).toHaveLength(2);
    await catalog.pool.query("UPDATE package_versions SET integrity_anomaly=true WHERE id=$1", [
      second.entries[0]?.artifactId,
    ]);
    expect((await discoverCompatibility(catalog.db, selection.matrixId)).entries).toHaveLength(1);
    await quarantineRuntime(catalog.db, selection.imageIds[0] ?? "", actor);
    expect((await discoverCompatibility(catalog.db, selection.matrixId)).entries).toEqual([]);
    expect((await catalog.pool.query("SELECT count(*) FROM jobs")).rows).toEqual(counts);
    await expect(
      discoverCompatibility(catalog.db, selection.matrixId, { limit: 25 }),
    ).rejects.toThrow();
    await expect(
      discoverCompatibility(catalog.db, selection.matrixId, { after: "invalid" }),
    ).rejects.toThrow();
  });
  it("lists actual Bun failures from the selected report, not a superseded environment", async () => {
    const old = await execution({
      name: "bun-failure-fixture",
      mutate(job, evidence) {
        if (job.image.kind !== "bun" || job.group !== "root") return;
        evidence.observations[0] = {
          index: 0,
          outcome: "fail",
          durationMs: 1,
          resolvedTo: null,
          error: {
            name: "Error",
            code: "ERR_MODULE_NOT_FOUND",
            message: "Authored missing module",
          },
        };
      },
    });
    const { report } = await aggregate(old.scan.scanId);
    expect(
      (
        await discoverCompatibility(catalog.db, selection.matrixId, { failureRuntime: "bun" })
      ).entries.map((entry) => entry.report.id),
    ).toEqual([report.id]);
    expect(
      (
        await discoverCompatibility(catalog.db, selection.matrixId, { failureRuntime: "any" })
      ).entries.map((entry) => entry.report.id),
    ).toEqual([report.id]);
    for (const failureRuntime of ["node", "deno"] as const)
      expect(
        (await discoverCompatibility(catalog.db, selection.matrixId, { failureRuntime })).entries,
      ).toEqual([]);
    const nextMatrix = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds, "directory_next_v1"),
      actor,
    );
    expect(
      (await discoverCompatibility(catalog.db, nextMatrix, { failureRuntime: "bun" })).entries[0]
        ?.matchesCurrentMatrix,
    ).toBe(false);
    const [currentScan] = await catalog.db
      .insert(schema.scans)
      .values({
        preparationId: old.scan.preparationId,
        matrixId: nextMatrix,
        state: "completed",
        requesterKey: "a".repeat(64),
        requesterExpiresAt: new Date(Date.now() + 86400_000),
        admissionPolicy: "admission_v1",
      })
      .returning();
    if (!currentScan) throw new Error("Missing fixture scan");
    const currentReport = {
      ...report,
      id: randomUUID(),
      scanId: currentScan.id,
      matrix: { ...report.matrix, id: nextMatrix, revision: "directory_next_v1" },
      outcome: "pass",
      cells: report.cells.map((cell) =>
        cell.outcome !== "fail"
          ? cell
          : {
              ...cell,
              outcome: "pass",
              failure: null,
              coverage: { ...cell.coverage, passed: cell.coverage.observed, failed: 0 },
              entries: cell.entries.map((entry) => ({ ...entry, outcome: "pass", failure: null })),
            },
      ),
    };
    await catalog.db.insert(schema.reports).values({
      id: currentReport.id,
      scanId: currentScan.id,
      classifierRevision: CLASSIFIER_REVISION,
      payload: currentReport,
    });
    expect(
      (await discoverCompatibility(catalog.db, nextMatrix)).entries.map((entry) => entry.report.id),
    ).toEqual([currentReport.id]);
    expect(
      (await discoverCompatibility(catalog.db, nextMatrix, { failureRuntime: "bun" })).entries,
    ).toEqual([]);
    await invalidateReport(catalog.db, currentReport.id, actor);
    expect(
      (await discoverCompatibility(catalog.db, nextMatrix, { failureRuntime: "bun" })).entries[0],
    ).toMatchObject({ matchesCurrentMatrix: false, report: { id: report.id } });
  });
  it("backs off a failed aggregation under concurrency while completing other scans", async () => {
    const broken = await execution({ name: "broken-report-fixture" });
    const healthy = await execution({ name: "healthy-report-fixture" });
    await catalog.pool.query(
      `ALTER TABLE reports ADD CONSTRAINT fixture_aggregation_failure CHECK(scan_id <> '${broken.scan.scanId}'::uuid)`,
    );
    try {
      const results = await concurrent(
        Array.from({ length: 8 }, () => aggregatePendingReports(catalog.db)),
      );
      expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.failed, 0)).toBe(1);
      expect((await scanProgress(catalog.db, healthy.scan.scanId))?.state).toBe("completed");
      expect((await scanProgress(catalog.db, broken.scan.scanId))?.state).toBe("aggregating");
      expect(await aggregatePendingReports(catalog.db)).toEqual({ completed: 0, failed: 0 });
      for (let retry = 0; retry < 2; retry++) {
        await catalog.pool.query(
          "UPDATE jobs SET available_at=now()-interval '1 second' WHERE scan_id=$1 AND kind='aggregation'",
          [broken.scan.scanId],
        );
        expect(await aggregatePendingReports(catalog.db)).toEqual({ completed: 0, failed: 1 });
      }
      expect((await scanProgress(catalog.db, broken.scan.scanId))?.state).toBe(
        "failed_infrastructure",
      );
    } finally {
      await catalog.pool.query("ALTER TABLE reports DROP CONSTRAINT fixture_aggregation_failure");
    }
    const raw = await catalog.db.select().from(schema.runs);
    const recoveredId = await reclassifyScan(catalog.db, broken.scan.scanId, actor);
    expect((await readReport(catalog.db, recoveredId))?.report).toMatchObject({
      outcome: "pass",
      coverageComplete: true,
    });
    expect((await scanProgress(catalog.db, broken.scan.scanId))?.state).toBe("completed");
    expect(await catalog.db.select().from(schema.runs)).toEqual(raw);
  });
  it("retains execution completion time independently of publication and reclassification", async () => {
    const { scan } = await execution();
    const [row] = await catalog.db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.id, scan.scanId));
    expect(row?.evidenceCompletedAt).toBeInstanceOf(Date);
    const observedAt = row?.evidenceCompletedAt?.toISOString();
    const { report } = await aggregate(scan.scanId);
    expect(report.observedAt).toBe(observedAt);
    expect(Date.parse(report.classifiedAt)).toBeGreaterThanOrEqual(Date.parse(observedAt ?? ""));
    await expect(
      catalog.db
        .update(schema.scans)
        .set({ evidenceCompletedAt: new Date(0) })
        .where(eq(schema.scans.id, scan.scanId)),
    ).rejects.toThrow();
    expect(
      (await readReport(catalog.db, await reclassifyScan(catalog.db, scan.scanId, actor)))?.report
        .observedAt,
    ).toBe(observedAt);
  });
  it("aggregates once under concurrent callers and serves views without creating work", async () => {
    const { scan } = await execution();
    const results = await concurrent(
      Array.from({ length: 12 }, () => aggregatePendingReports(catalog.db)),
    );
    expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
    const progress = await scanProgress(catalog.db, scan.scanId);
    const report = (await readReport(catalog.db, progress?.reportId ?? ""))?.report;
    expect(report).toMatchObject({
      outcome: "pass",
      coverageComplete: true,
      evidenceLevel: "smoke_tested",
      classifierRevision: CLASSIFIER_REVISION,
    });
    expect(report?.cells).toHaveLength(16);
    const jobsBefore = await catalog.db.select().from(schema.jobs);
    await concurrent(
      Array.from({ length: 20 }, () => readReport(catalog.db, progress?.reportId ?? "")),
    );
    expect(await catalog.db.select().from(schema.jobs)).toEqual(jobsBefore);
    expect(await catalog.db.select().from(schema.reports)).toHaveLength(1);
  });
  it("preserves a CommonJS TLA failure separately from passing ESM observations", async () => {
    const { scan } = await execution({
      mutate(job, evidence) {
        if (job.image.kind === "node" && job.mode === "commonjs" && job.group === "root") {
          evidence.observations[0] = {
            index: 0,
            outcome: "fail",
            durationMs: 1,
            resolvedTo: null,
            error: {
              name: "Error",
              code: "ERR_REQUIRE_ASYNC_MODULE",
              message: "Top-level await prevents require.",
            },
          };
        }
      },
    });
    const { report } = await aggregate(scan.scanId);
    expect(report.outcome).toBe("partial");
    expect(
      report.cells
        .filter((cell) => cell.outcome === "fail")
        .every((cell) => cell.failure?.classification === "commonjs_require_failed"),
    ).toBe(true);
    expect(report.coverageComplete).toBe(true);
  });
  it("discloses omitted patterns while retaining successful root cells", async () => {
    const { scan } = await execution({
      manifest: { exports: { ".": "./index.js", "./*": "./*.js" } },
    });
    const { report } = await aggregate(scan.scanId);
    expect(report).toMatchObject({
      outcome: "inconclusive",
      coverageComplete: false,
      omissions: { counts: { pattern: 1 } },
    });
    expect(
      report.cells.filter((cell) => cell.group === "root").every((cell) => cell.outcome === "pass"),
    ).toBe(true);
  });
  it("supports variable matrices and keeps inapplicable roots out of coverage", async () => {
    const matrixId = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds.slice(2), "reports_two_v1"),
      actor,
    );
    const { scan } = await execution({
      matrixId,
      manifest: { exports: { "./util": "./util.js" } },
    });
    const { report } = await aggregate(scan.scanId);
    expect(report.cells).toHaveLength(8);
    expect(
      report.cells
        .filter((cell) => cell.group === "root")
        .every((cell) => cell.outcome === "not_applicable"),
    ).toBe(true);
    expect(report.outcome).toBe("pass");
  });
  it("records preparation prerequisites without inventing runtime failures", async () => {
    const { scan } = await execution({ failure: "native_compilation_required" });
    const { report } = await aggregate(scan.scanId);
    expect(report).toMatchObject({
      outcome: "unsupported",
      evidenceLevel: "static_only",
      preparation: {
        outcome: "unsupported",
        failure: { phase: "preparation", origin: "prerequisite" },
      },
    });
    expect(
      report.cells.every((cell) => cell.runId === null && cell.coverage.planned === null),
    ).toBe(true);
  });
  it("publishes terminal scan evidence and preserves its lifecycle", async () => {
    const { scan } = await execution();
    await catalog.db
      .update(schema.scans)
      .set({ state: "inconclusive", finishedAt: new Date() })
      .where(eq(schema.scans.id, scan.scanId));
    const { report } = await aggregate(scan.scanId);
    expect(report.outcome).toBe("inconclusive");
    expect((await scanProgress(catalog.db, scan.scanId))?.state).toBe("inconclusive");
  });
  it("queues cancelled reports once and changes the progress revision", async () => {
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    await catalog.db
      .update(schema.scans)
      .set({ state: "cancelled", finishedAt: new Date() })
      .where(eq(schema.scans.id, scan.scanId));
    const before = await scanProgress(catalog.db, scan.scanId);
    await reconcileCatalog(catalog.db);
    const queued = await scanProgress(catalog.db, scan.scanId);
    expect(queued?.revision).not.toBe(before?.revision);
    await reconcileCatalog(catalog.db);
    expect((await scanProgress(catalog.db, scan.scanId))?.revision).toBe(queued?.revision);
    const { report } = await aggregate(scan.scanId);
    expect(report).toMatchObject({
      outcome: "inconclusive",
      evidenceLevel: "static_only",
      preparation: { failure: { classification: "job_cancelled" } },
    });
  });
  it("keeps static-analysis diagnostics immutable after classification", async () => {
    const { scan } = await execution();
    const diagnostics = {
      phase: "static_analysis",
      classification: "package_manifest_invalid",
      message: "Invalid exports.",
    };
    await catalog.db
      .update(schema.scans)
      .set({ diagnostics })
      .where(eq(schema.scans.id, scan.scanId));
    const { report } = await aggregate(scan.scanId);
    expect(report.preparation.failure?.phase).toBe("static_analysis");
    await expect(
      catalog.db
        .update(schema.scans)
        .set({ diagnostics: { ...diagnostics, message: "Overwritten" } })
        .where(eq(schema.scans.id, scan.scanId)),
    ).rejects.toThrow();
  });
  it("reclassifies into a new revision without changing retained evidence or invalidation", async () => {
    const { scan } = await execution();
    const raw = await catalog.db.select().from(schema.runs);
    const previousId = randomUUID();
    await catalog.db.insert(schema.reports).values({
      id: previousId,
      scanId: scan.scanId,
      classifierRevision: "classifier_v1",
      payload: { historical: true },
      invalidatedAt: new Date(),
      invalidationReason: "Faulty retained evidence.",
    });
    const reportId = await reclassifyScan(catalog.db, scan.scanId, actor);
    expect(reportId).not.toBe(previousId);
    expect(await catalog.db.select().from(schema.runs)).toEqual(raw);
    expect(
      (await catalog.db.select().from(schema.reports).where(eq(schema.reports.id, previousId)))[0],
    ).toMatchObject({ payload: { historical: true }, replacedBy: reportId });
    expect((await readReport(catalog.db, reportId))?.status).toMatchObject({
      current: false,
      invalidationReason: "Faulty retained evidence.",
    });
    expect(await reclassifyScan(catalog.db, scan.scanId, actor)).toBe(reportId);
  });
});

describe("public report reads", () => {
  it("projects compact evidence without losing failures, coverage, runtime pins or status", async () => {
    const { scan } = await execution({
      manifest: {
        exports: { ".": "./index.js", "./util": "./util.js", "./server": "./server.js" },
        peerDependencies: { renderer: "^2" },
        peerDependenciesMeta: { renderer: { optional: true } },
      },
      mutate(job, evidence) {
        if (job.group !== "subpaths") return;
        evidence.observations[1] = {
          index: 1,
          outcome: "fail",
          durationMs: 1,
          resolvedTo: null,
          error: {
            name: "Error",
            code: "MODULE_NOT_FOUND",
            message: "Cannot find module 'renderer'",
          },
        };
      },
    });
    const envelope = await aggregate(scan.scanId);
    const { report } = envelope;
    const jobs = await catalog.db.select().from(schema.jobs);
    const api = createReportApi(catalog.db);
    const url = `http://localhost/api/v1/reports/${report.id}/summary`;
    const response = await api(new Request(url));
    expect(response.status).toBe(200);
    const compact = reportSummaryEnvelopeSchema.parse(await response.json());
    expect(compact.status).toEqual(envelope.status);
    expect(compact.reportPath).toBe(`/reports/${report.id}`);
    expect(compact.summary).toMatchObject({
      id: report.id,
      artifact: report.artifact,
      matrix: report.matrix,
      observedAt: report.observedAt,
      classifiedAt: report.classifiedAt,
      classifierRevision: CLASSIFIER_REVISION,
      outcome: "inconclusive",
      coverageComplete: true,
      missingOptionalPeers: [{ name: "renderer", range: "^2" }],
      missingOptionalPeersTruncated: false,
    });
    expect(compact.summary.runtimes).toEqual(
      report.matrix.images.map(({ profileId }) => ({ profileId, outcome: "inconclusive" })),
    );
    expect(compact.summary.cells).toEqual(
      report.cells.map(({ entries: _entries, sessions: _sessions, ...cell }) => cell),
    );
    expect(JSON.stringify(compact)).not.toMatch(
      /"(entries|sessions|staticObservations|assertions)":/,
    );
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(envelope).length);
    const etag = response.headers.get("etag") ?? "";
    expect((await api(new Request(url, { headers: { "if-none-match": etag } }))).status).toBe(304);
    const head = await api(new Request(url, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    await invalidateReport(catalog.db, report.id, actor);
    const historical = await api(new Request(url, { headers: { "if-none-match": etag } }));
    expect(historical.status).toBe(200);
    expect(await historical.json()).toMatchObject({
      status: { current: false, invalidationReason: actor.reason },
      summary: compact.summary,
    });
    expect((await api(new Request(url, { method: "POST" }))).status).toBe(405);
    expect((await api(new Request("http://localhost/api/v1/reports/bad/summary"))).status).toBe(
      400,
    );
    expect(
      (await api(new Request(`http://localhost/api/v1/reports/${randomUUID()}/summary`))).status,
    ).toBe(404);
    expect(await catalog.db.select().from(schema.jobs)).toEqual(jobs);
  });
  it("keeps preparation failures distinct from runtime failures in compact evidence", async () => {
    const { scan } = await execution({ failure: "install_script_required" });
    const { report } = await aggregate(scan.scanId);
    const response = await createReportApi(catalog.db)(
      new Request(`http://localhost/api/v1/reports/${report.id}/summary`),
    );
    const { summary } = reportSummaryEnvelopeSchema.parse(await response.json());
    expect(summary.preparation.failure?.classification).toBe("install_script_required");
    expect(summary.outcome).toBe(report.outcome);
    expect(summary.evidenceLevel).toBe("static_only");
    expect(summary.coverageComplete).toBe(false);
    expect(summary.missingOptionalPeers).toEqual([]);
  });
  it("bounds optional peer requirements and explicitly marks omitted summary details", async () => {
    const peers = Array.from({ length: 18 }, (_, index) => `peer-${index}`);
    const { scan } = await execution({
      manifest: {
        exports: {
          ".": "./index.js",
          ...Object.fromEntries(peers.map((peer) => [`./${peer}`, `./${peer}.js`])),
        },
        peerDependencies: Object.fromEntries(peers.map((peer) => [peer, "^1"])),
        peerDependenciesMeta: Object.fromEntries(peers.map((peer) => [peer, { optional: true }])),
      },
      mutate(job, evidence) {
        if (job.group !== "subpaths") return;
        evidence.observations.forEach((entry, index) => {
          evidence.observations[index] = {
            index: entry.index,
            durationMs: entry.durationMs,
            outcome: "fail",
            resolvedTo: null,
            error: {
              name: "Error",
              code: "MODULE_NOT_FOUND",
              message: `Cannot find module '${peers[index]}'`,
            },
          };
        });
      },
    });
    const { report } = await aggregate(scan.scanId);
    const response = await createReportApi(catalog.db)(
      new Request(`http://localhost/api/v1/reports/${report.id}/summary`),
    );
    const { summary } = reportSummaryEnvelopeSchema.parse(await response.json());
    expect(summary.missingOptionalPeers).toHaveLength(16);
    expect(summary.missingOptionalPeersTruncated).toBe(true);
    expect(new Set(summary.missingOptionalPeers.map((peer) => peer.name)).size).toBe(16);
    expect(
      summary.cells.find((cell) => cell.group === "subpaths")?.coverage.prerequisiteLimited,
    ).toBe(18);
  });
  it("preserves exact entry identities in reports and evidence downloads", async () => {
    const { scan } = await execution({
      manifest: { exports: { ".": "./index.js", "./a\u202eb": "./a.js", "./ab": "./b.js" } },
    });
    const { report } = await aggregate(scan.scanId);
    const cell = report.cells.find((cell) => cell.group === "subpaths");
    expect(cell?.entries.map((entry) => entry.specifier)).toEqual([
      "@scope/report-fixture/a\u202eb",
      "@scope/report-fixture/ab",
    ]);
    const api = createReportApi(catalog.db);
    const response = await api(
      new Request(`http://localhost/api/v1/reports/${report.id}/evidence?runId=${cell?.runId}`),
    );
    expect(await response.json()).toMatchObject({
      evidence: { entries: cell?.entries.map((entry) => entry.specifier) },
      displayEntries: cell?.entries.map((entry) => entry.displaySpecifier),
    });
    const details = await api(
      new Request(`http://localhost/api/v1/reports/${report.id}/cell?runId=${cell?.runId}`),
    );
    expect(await details.json()).toMatchObject({ schemaVersion: 1, cell });
    expect(
      (
        await api(
          new Request(`http://localhost/api/v1/reports/${report.id}/cell?runId=${randomUUID()}`),
        )
      ).status,
    ).toBe(404);
  });
  it("validates identifiers and changes ETags immediately on quarantine and invalidation", async () => {
    const { scan } = await execution();
    const { report } = await aggregate(scan.scanId);
    const api = createReportApi(catalog.db);
    const url = `http://localhost/api/v1/reports/${report.id}`;
    const initial = await api(new Request(url));
    expect(initial.status).toBe(200);
    const etag = initial.headers.get("etag") ?? "";
    expect((await api(new Request(url, { headers: { "if-none-match": etag } }))).status).toBe(304);
    await quarantineRuntime(catalog.db, selection.imageIds[0] ?? "", actor);
    const quarantined = await api(new Request(url, { headers: { "if-none-match": etag } }));
    expect(quarantined.status).toBe(200);
    expect(await quarantined.json()).toMatchObject({ status: { current: false } });
    await invalidateReport(catalog.db, report.id, actor);
    expect(await (await api(new Request(url))).json()).toMatchObject({
      status: { invalidationReason: actor.reason },
    });
    expect((await api(new Request("http://localhost/api/v1/reports/not-a-uuid"))).status).toBe(400);
    expect((await api(new Request(url, { method: "POST" }))).status).toBe(405);
    expect(await (await api(new Request(url, { method: "HEAD" }))).text()).toBe("");
  });
  it("serves bounded sanitized logs only for runs belonging to the report and enforces expiry", async () => {
    const { scan } = await execution({
      mutate(_job, evidence) {
        for (const session of evidence.sessions)
          session.logs.stdout =
            "\u001b]8;;https://example.com/(path)\u001b\\<script>inert text</script>\u001b]8;;\u001b\\\u001b[31mred\u001b[0m";
      },
    });
    const { report } = await aggregate(scan.scanId);
    const runId = report.cells.find((cell) => cell.group === "root")?.runId ?? "";
    const logs = await readReportLogs(catalog.db, report.id, runId);
    expect(logs?.availability).toBe("available");
    expect(JSON.stringify(logs)).toContain("<script>inert text</script>red");
    expect(JSON.stringify(logs)).not.toContain("example.com");
    expect(await readReportLogs(catalog.db, report.id, randomUUID())).toBeNull();
    await catalog.db
      .update(schema.runs)
      .set({ logsExpireAt: new Date(0) })
      .where(eq(schema.runs.id, runId));
    expect(await readReportLogs(catalog.db, report.id, runId)).toMatchObject({
      availability: "expired",
      sessions: [],
    });
  });
  it("exports versioned JSON, verified lock bytes and reproduction inputs", async () => {
    const { scan, result } = await execution();
    const { report } = await aggregate(scan.scanId);
    const api = createReportApi(catalog.db);
    const base = `http://localhost/api/v1/reports/${report.id}`;
    const download = await api(new Request(`${base}/json`));
    expect(download.headers.get("content-disposition")).toContain(report.id);
    expect(await download.json()).toMatchObject({ report });
    const input = await (await api(new Request(`${base}/reproduction`))).json();
    expect(parseReproductionInputs(input)).toMatchObject({
      kind: "reproduction_inputs",
      reportId: report.id,
      snapshot: result.snapshot,
    });
    const lock = await api(new Request(`${base}/lock`));
    expect(lock.headers.get("x-content-sha256")).toBe(result.snapshot.lockDigest);
    expect(Buffer.from(await lock.arrayBuffer()).toString("base64")).toBe(result.lockBase64);
    const progress = await api(new Request(`http://localhost/api/v1/scans/${scan.scanId}`));
    expect(await progress.json()).toMatchObject({ reportId: report.id });
    await reconcileCatalog(catalog.db);
    expect(await aggregatePendingReports(catalog.db)).toEqual({ completed: 0, failed: 0 });
  });
});

it("distinguishes invalid read inputs from incompatible persisted reports", async () => {
  const { scan } = await execution();
  const id = randomUUID();
  await catalog.db.insert(schema.reports).values({
    id,
    scanId: scan.scanId,
    classifierRevision: "incompatible_fixture",
    payload: { historical: true },
  });
  const api = createReportApi(catalog.db);
  expect((await api(new Request(`http://localhost/api/v1/reports/${id}`))).status).toBe(503);
  for (const path of [
    "reports/not-a-uuid",
    "history?name=invalid/name",
    "history?name=valid-name&before=not-a-cursor",
  ]) {
    expect((await api(new Request(`http://localhost/api/v1/${path}`))).status).toBe(400);
  }
});
