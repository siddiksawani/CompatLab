import { randomUUID } from "node:crypto";
import { PREPARATION_PROFILE_REVISION } from "@compatlab/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  abandonAttempt,
  admitScan,
  applyRetention,
  auditBackup,
  cancelScan,
  claimJob,
  migrateCatalog,
  operationStatus,
  readyWorker,
  reconcileCatalog,
  registerMatrix,
  registerWorker,
  removeScanLogs,
  renewJob,
  retireWorker,
  retryInfrastructure,
  schema,
  setAdmissionPaused,
  setDeploymentPause,
  setWorkerGuard,
  setWorkerState,
  submitJobResult,
  updateWorkerDefinition,
} from "../src/index.js";
import { prepared } from "./execution-fixtures.js";
import {
  actor,
  admitted,
  artifact,
  database,
  hash,
  image,
  matrix,
  options,
  seedMatrix,
  seedReport,
} from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let selection: Awaited<ReturnType<typeof seedMatrix>>;
let worker: Awaited<ReturnType<typeof createWorker>>;
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
  await catalog.pool.query(
    "UPDATE service_controls SET admission_paused=false,worker_guard_enabled=false,deployment_release=NULL",
  );
  selection = await seedMatrix(catalog.db);
  worker = await createWorker();
});
async function createWorker() {
  const registered = await registerWorker(
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
  await readyWorker(catalog.db, registered.token, { sessionId });
  return { ...registered, sessionId };
}
async function claim() {
  return claimJob(catalog.db, worker.token, { sessionId: worker.sessionId });
}
describe("audited operator controls", () => {
  it("keeps a retried backup's capture age and records its digest only once", async () => {
    const capturedAt = new Date(Date.now() - 48 * 3600_000).toISOString();
    await auditBackup(catalog.db, "f".repeat(64), 1024, actor, capturedAt);
    await auditBackup(catalog.db, "f".repeat(64), 1024, actor);
    const status = await operationStatus(catalog.db);
    expect(new Date(String(status.health?.lastBackupAt)).toISOString()).toBe(capturedAt);
    expect(
      (await catalog.pool.query("SELECT id FROM audit_events WHERE action='backup_uploaded'")).rows,
    ).toHaveLength(1);
  });
  it("requires an idle deployment and preserves administrative drain during worker replacement", async () => {
    const row = (await catalog.db.select().from(schema.workers))[0];
    if (!row) throw new Error("Missing worker fixture.");
    await expect(
      updateWorkerDefinition(catalog.db, worker.workerId, row.capabilities, 1, actor),
    ).rejects.toThrow("Pause deployment");
    await setDeploymentPause(catalog.db, "c".repeat(40), true, actor);
    await setWorkerState(catalog.db, worker.workerId, "drain", actor);
    await updateWorkerDefinition(catalog.db, worker.workerId, row.capabilities, 1, actor);
    const sessionId = randomUUID();
    await readyWorker(catalog.db, worker.token, { sessionId });
    expect((await operationStatus(catalog.db)).workers[0]).toMatchObject({
      acceptingJobs: false,
      recoveryRequired: false,
      capacity: 1,
    });
    await setDeploymentPause(catalog.db, "c".repeat(40), false, actor);
    await setWorkerState(catalog.db, worker.workerId, "resume", actor);
    admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    await setDeploymentPause(catalog.db, "d".repeat(40), true, actor);
    await expect(
      updateWorkerDefinition(catalog.db, worker.workerId, row.capabilities, 1, actor),
    ).rejects.toThrow("finish all work");
  });
  it("keeps manual maintenance paused when its matching deployment completes", async () => {
    const release = "a".repeat(40);
    await setDeploymentPause(catalog.db, release, true, actor);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "admission_paused",
    });
    await expect(setDeploymentPause(catalog.db, "b".repeat(40), false, actor)).rejects.toThrow(
      "different release",
    );
    await setAdmissionPaused(catalog.db, true, actor);
    await setDeploymentPause(catalog.db, release, false, actor);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "admission_paused",
    });
    await setAdmissionPaused(catalog.db, false, actor);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      kind: "admitted",
    });
  });
  async function stableWorker() {
    await catalog.pool.query(
      "UPDATE worker_availability SET healthy_since=now()-interval '121 seconds'",
    );
    await reconcileCatalog(catalog.db);
  }
  it("pauses after a three-minute outage, keeps cached reports, and requires stable recovery", async () => {
    const cached = await seedReport(catalog.db, selection.matrixId);
    await setWorkerGuard(catalog.db, true, actor);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
    await stableWorker();
    const existing = artifact();
    admitted(await admitScan(catalog.db, existing, options(selection.matrixId)));
    await catalog.pool.query("UPDATE workers SET last_seen_at=now()-interval '181 seconds'");
    await catalog.pool.query(
      "UPDATE worker_availability SET last_healthy_at=now()-interval '181 seconds'",
    );
    // Admission fails closed even if the control maintenance loop has stopped.
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
    expect(await admitScan(catalog.db, cached.source, options(selection.matrixId))).toMatchObject({
      kind: "cached",
      reportId: cached.report.id,
    });
    expect(await admitScan(catalog.db, existing, options(selection.matrixId))).toMatchObject({
      kind: "existing",
    });
    await reconcileCatalog(catalog.db);
    worker.sessionId = randomUUID();
    await readyWorker(catalog.db, worker.token, { sessionId: worker.sessionId });
    await reconcileCatalog(catalog.db);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
    await stableWorker();
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      kind: "admitted",
    });
    expect((await operationStatus(catalog.db)).workerAvailability[0]).toMatchObject({
      enabled: true,
      paused: false,
    });
  });
  it("does not resume manual pauses, drained workers, or incompatible matrices", async () => {
    await setWorkerGuard(catalog.db, true, actor);
    await setAdmissionPaused(catalog.db, true, actor);
    await stableWorker();
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "admission_paused",
    });
    await setAdmissionPaused(catalog.db, false, actor);
    await setWorkerState(catalog.db, worker.workerId, "drain", actor);
    await catalog.pool.query(
      "UPDATE worker_availability SET last_healthy_at=now()-interval '181 seconds'",
    );
    await reconcileCatalog(catalog.db);
    await stableWorker();
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
    await setWorkerState(catalog.db, worker.workerId, "resume", actor);
    await catalog.pool.query(
      "UPDATE workers SET capabilities=jsonb_set(capabilities,'{policyRevision}','\"different_v1\"')",
    );
    await reconcileCatalog(catalog.db);
    await stableWorker();
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
  });
  it("does not treat an unobserved outage as continuously healthy", async () => {
    await setWorkerGuard(catalog.db, true, actor);
    await stableWorker();
    await catalog.pool.query(
      "UPDATE worker_availability SET last_healthy_at=now()-interval '181 seconds',checked_at=now()-interval '181 seconds'",
    );
    await reconcileCatalog(catalog.db);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      reason: "worker_unavailable",
    });
    await stableWorker();
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      kind: "admitted",
    });
  });
  it("returns only the remaining delay when an hourly request is about to expire", async () => {
    const source = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const [original] = await catalog.db
      .select()
      .from(schema.preparations)
      .where(eq(schema.preparations.id, source.preparationId));
    if (!original) throw new Error("Missing preparation fixture.");
    const preparations = await catalog.db
      .insert(schema.preparations)
      .values(
        Array.from({ length: 10 }, () => ({
          artifactId: original.artifactId,
          profileRevision: original.profileRevision,
          platform: original.platform,
        })),
      )
      .returning();
    const key = hash("expiring-client");
    await catalog.db.insert(schema.scans).values(
      preparations.map((prep) => ({
        preparationId: prep.id,
        matrixId: selection.matrixId,
        requesterKey: key,
        requestedAt: new Date(Date.now() - 3_590_000),
        requesterExpiresAt: new Date(Date.now() + 86400_000),
        admissionPolicy: "fixture",
        state: "cancelled" as const,
      })),
    );
    const result = await admitScan(catalog.db, artifact(), {
      ...options(selection.matrixId),
      requesterKey: key,
    });
    expect(result).toMatchObject({ kind: "throttled", reason: "requester_rate" });
    if (result.kind !== "throttled") throw new Error("Expected rate limit.");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(10);
  });
  it("counts old daily pseudonyms for active work and the remaining hourly window", async () => {
    const previous = hash("previous-day"),
      current = hash("current-day");
    const first = admitted(
      await admitScan(catalog.db, artifact(), {
        ...options(selection.matrixId),
        requesterKey: previous,
      }),
    );
    const second = admitted(
      await admitScan(catalog.db, artifact(), {
        ...options(selection.matrixId),
        requesterKey: previous,
      }),
    );
    const rotated = {
      ...options(selection.matrixId),
      requesterKey: current,
      requesterAliases: [previous],
    };
    expect(await admitScan(catalog.db, artifact(), rotated)).toMatchObject({
      kind: "throttled",
      reason: "requester_limit",
    });
    await cancelScan(catalog.db, first.scanId, actor);
    await cancelScan(catalog.db, second.scanId, actor);
    for (let index = 0; index < 8; index++) {
      const source = admitted(
        await admitScan(catalog.db, artifact(), {
          ...options(selection.matrixId),
          requesterKey: previous,
        }),
      );
      await cancelScan(catalog.db, source.scanId, actor);
    }
    const blocked = await admitScan(catalog.db, artifact(), rotated);
    expect(blocked).toMatchObject({ kind: "throttled", reason: "requester_rate" });
    if (blocked.kind !== "throttled") throw new Error("Expected requester rate limit.");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(3500);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });
  it("fails closed when admission controls are missing", async () => {
    await catalog.pool.query("DELETE FROM service_controls");
    try {
      expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
        kind: "throttled",
        reason: "admission_paused",
      });
      await expect(setAdmissionPaused(catalog.db, false, actor)).rejects.toThrow("unavailable");
    } finally {
      await catalog.pool.query("INSERT INTO service_controls DEFAULT VALUES");
    }
  });
  it("fences a destroyed host and reassigns unfinished preparation", async () => {
    admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const job = await claim();
    if (!job) throw new Error("Missing preparation.");
    await retireWorker(catalog.db, worker.workerId, actor);
    await expect(claim()).rejects.toThrow();
    const replacement = await createWorker();
    const next = await claimJob(catalog.db, replacement.token, {
      sessionId: replacement.sessionId,
    });
    expect(next).toMatchObject({ kind: "preparation", jobId: job.jobId });
    expect(next?.attemptToken).not.toBe(job.attemptToken);
    expect(
      (await catalog.db.select().from(schema.auditEvents)).find(
        (row) => row.action === "worker_retired",
      )?.details,
    ).toMatchObject({ hostDestructionConfirmed: true });
  });
  it("removes terminal logs with an audit while preserving raw observations", async () => {
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    await expect(removeScanLogs(catalog.db, scan.scanId, actor)).rejects.toThrow("terminal");
    await cancelScan(catalog.db, scan.scanId, actor);
    await catalog.db.insert(schema.runs).values({
      scanId: scan.scanId,
      matrixId: selection.matrixId,
      imageId: selection.imageIds[0] ?? "",
      mode: "esm",
      probeGroup: "root",
      logs: { sessions: [] },
      logsExpireAt: new Date(Date.now() + 86400_000),
      rawEvidence: { retained: true },
    });
    expect(await removeScanLogs(catalog.db, scan.scanId, actor)).toEqual({ runs: 1 });
    expect((await catalog.db.select().from(schema.runs))[0]).toMatchObject({
      logs: null,
      rawEvidence: { retained: true },
    });
  });
  it("drains only new claims while current leases can finish", async () => {
    admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const job = await claim();
    if (!job) throw new Error("Missing preparation.");
    const attempt = {
      sessionId: worker.sessionId,
      jobId: job.jobId,
      attemptToken: job.attemptToken,
    };
    await setWorkerState(catalog.db, worker.workerId, "drain", actor);
    expect(await claim()).toBeNull();
    expect(await renewJob(catalog.db, worker.token, attempt)).toMatchObject({
      remainingMs: expect.any(Number),
    });
    await submitJobResult(catalog.db, worker.token, { ...attempt, result: prepared(job) });
    expect(await claim()).toBeNull();
    await setWorkerState(catalog.db, worker.workerId, "resume", actor);
    expect(await claim()).toMatchObject({ kind: "run" });
    const audits = await catalog.db.select().from(schema.auditEvents);
    expect(
      audits.some(
        (row) =>
          row.action === "worker_drain" && row.actor === actor.actor && row.reason === actor.reason,
      ),
    ).toBe(true);
  });
  it("cancels shared preparation and holds capacity until cleanup is confirmed", async () => {
    const source = artifact(),
      first = admitted(await admitScan(catalog.db, source, options(selection.matrixId)));
    const alternate = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds, "alternate_v1"),
      actor,
    );
    // Shared preparation is reserved before the second scan's cooldown has elapsed.
    const [second] = await catalog.db
      .insert(schema.scans)
      .values({
        preparationId: first.preparationId,
        matrixId: alternate,
        requesterExpiresAt: new Date(Date.now() + 86400_000),
        admissionPolicy: "test",
      })
      .returning();
    const job = await claim();
    if (!job) throw new Error("Missing preparation.");
    const attempt = {
      sessionId: worker.sessionId,
      jobId: job.jobId,
      attemptToken: job.attemptToken,
    };
    const cancelled = await cancelScan(catalog.db, first.scanId, actor);
    expect(cancelled.affectedScanIds.sort()).toEqual([first.scanId, second?.id].sort());
    await expect(renewJob(catalog.db, worker.token, attempt)).rejects.toMatchObject({
      code: "stale_attempt",
    });
    expect(
      (await catalog.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.jobId)))[0],
    ).toMatchObject({ state: "leased", cleanupRequired: true });
    await abandonAttempt(catalog.db, worker.token, { ...attempt, cleanupConfirmed: true });
    expect(
      (await catalog.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.jobId)))[0],
    ).toMatchObject({ state: "finished", cleanupRequired: false });
  });
  it("retries infrastructure failures as new scans and rejects retries before cleanup", async () => {
    const first = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const job = await claim();
    if (!job) throw new Error("Missing preparation.");
    await catalog.db
      .update(schema.scans)
      .set({ state: "failed_infrastructure", finishedAt: new Date() })
      .where(eq(schema.scans.id, first.scanId));
    await expect(retryInfrastructure(catalog.db, first.scanId, actor)).rejects.toThrow(
      "confirmed cleanup",
    );
    await abandonAttempt(catalog.db, worker.token, {
      sessionId: worker.sessionId,
      jobId: job.jobId,
      attemptToken: job.attemptToken,
      cleanupConfirmed: true,
    });
    const retried = admitted(await retryInfrastructure(catalog.db, first.scanId, actor));
    expect(retried.scanId).not.toBe(first.scanId);
    expect(retried.preparationId).not.toBe(first.preparationId);
    expect(
      (await catalog.db.select().from(schema.scans).where(eq(schema.scans.id, first.scanId)))[0]
        ?.state,
    ).toBe("failed_infrastructure");
    expect(
      (await catalog.db.select().from(schema.auditEvents)).find(
        (row) => row.action === "infrastructure_retry_requested",
      )?.details,
    ).toMatchObject({ previousScanId: first.scanId, scanId: retried.scanId });
  });
  it("pauses new work atomically while preserving existing progress", async () => {
    const source = artifact(),
      reserved = admitted(await admitScan(catalog.db, source, options(selection.matrixId)));
    await setAdmissionPaused(catalog.db, true, actor);
    expect(await admitScan(catalog.db, source, options(selection.matrixId))).toMatchObject({
      kind: "existing",
      scanId: reserved.scanId,
    });
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      kind: "throttled",
      reason: "admission_paused",
    });
    expect((await operationStatus(catalog.db)).health).toMatchObject({ admissionPaused: true });
    await setAdmissionPaused(catalog.db, false, actor);
    expect(await admitScan(catalog.db, artifact(), options(selection.matrixId))).toMatchObject({
      kind: "admitted",
    });
  });
  it("limits new work per requester per hour, including completed scans", async () => {
    for (let index = 0; index < 10; index++) {
      const scan = admitted(
        await admitScan(catalog.db, artifact(), options(selection.matrixId, "same-client")),
      );
      await cancelScan(catalog.db, scan.scanId, actor);
    }
    expect(
      await admitScan(catalog.db, artifact(), options(selection.matrixId, "same-client")),
    ).toMatchObject({ kind: "throttled", reason: "requester_rate" });
  });
  it("purges only expired logs, pseudonyms and audits while retaining identities and evidence", async () => {
    const first = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const [prep] = await catalog.db
      .select()
      .from(schema.preparations)
      .where(eq(schema.preparations.id, first.preparationId));
    if (!prep) throw new Error("Missing fixture preparation.");
    const [oldPrep] = await catalog.db
      .insert(schema.preparations)
      .values({
        artifactId: prep.artifactId,
        profileRevision: prep.profileRevision,
        platform: prep.platform,
      })
      .returning();
    if (!oldPrep) throw new Error("Missing old preparation.");
    const [oldScan] = await catalog.db
      .insert(schema.scans)
      .values({
        preparationId: oldPrep.id,
        matrixId: selection.matrixId,
        requesterKey: "a".repeat(64),
        accountKey: "b".repeat(64),
        requestedAt: new Date(Date.now() - 9 * 86400_000),
        requesterExpiresAt: new Date(Date.now() - 2 * 86400_000),
        admissionPolicy: "test",
      })
      .returning();
    if (!oldScan) throw new Error("Missing old scan.");
    await catalog.db.insert(schema.runs).values({
      scanId: oldScan.id,
      matrixId: selection.matrixId,
      imageId: selection.imageIds[0] ?? "",
      mode: "esm",
      probeGroup: "root",
      logs: { sessions: [] },
      logsExpireAt: new Date(0),
      rawEvidence: { retained: true },
    });
    await catalog.db.insert(schema.auditEvents).values({
      ...actor,
      action: "old_fixture",
      details: {},
      createdAt: new Date(Date.now() - 181 * 86400_000),
    });
    const counts = await applyRetention(catalog.db, actor);
    expect(counts).toEqual({ logs: 1, requesters: 1, audits: 1 });
    expect((await catalog.db.select().from(schema.runs))[0]).toMatchObject({
      logs: null,
      rawEvidence: { retained: true },
    });
    expect(
      (await catalog.db.select().from(schema.scans).where(eq(schema.scans.id, oldScan.id)))[0],
    ).toMatchObject({ requesterKey: null, accountKey: null });
    await expect(catalog.pool.query("DELETE FROM audit_events")).rejects.toThrow("immutable");
    expect(await applyRetention(catalog.db, actor)).toEqual({ logs: 0, requesters: 0, audits: 0 });
  });
});
