import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { type JobAssignment, PREPARATION_PROFILE_REVISION } from "@compatlab/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createControlServer } from "../../../services/control/src/server.js";
import { ControlClient } from "../../../services/worker/src/remote/client.js";
import {
  abandonAttempt,
  admitScan,
  authorizeSnapshotEviction,
  blockSubject,
  claimJob,
  migrateCatalog,
  readyWorker,
  reconcileCatalog,
  registerWorker,
  renewJob,
  scanProgress,
  schema,
  submitJobResult,
  workerSnapshotPins,
} from "../src/index.js";
import { prepared, runEvidence } from "./execution-fixtures.js";
import {
  actor,
  admitted,
  artifact,
  concurrent,
  database,
  hash,
  image,
  options,
  seedMatrix,
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
const attempt = (job: JobAssignment, sessionId = worker.sessionId) => ({
  sessionId,
  jobId: job.jobId,
  attemptToken: job.attemptToken,
});
async function next(owner = worker) {
  const job = await claimJob(catalog.db, owner.token, { sessionId: owner.sessionId });
  if (!job) throw new Error("Expected a runnable fixture job.");
  return job;
}
async function reserve() {
  const source = artifact();
  const scan = admitted(await admitScan(catalog.db, source, options(selection.matrixId)));
  return { source, scan };
}
async function finishPreparation() {
  const fixture = await reserve();
  const job = await next();
  expect(job.kind).toBe("preparation");
  const result = prepared(job);
  await submitJobResult(catalog.db, worker.token, { ...attempt(job), result });
  return { ...fixture, job, result };
}

describe("durable worker scheduling", () => {
  it("claims public work ahead of older curated coverage jobs", async () => {
    const background = admitted(
      await admitScan(catalog.db, artifact(), {
        ...options(selection.matrixId),
        source: "coverage",
      }),
    );
    const foreground = await reserve();
    expect((await next()).scanId).toBe(foreground.scan.scanId);
    expect(
      (
        await catalog.db.select().from(schema.scans).where(eq(schema.scans.id, background.scanId))
      )[0]?.source,
    ).toBe("coverage");
  });
  it("denies eviction of reserved snapshots and removes evicted snapshots from reuse", async () => {
    const fixture = await finishPreparation();
    const inventory = { sessionId: worker.sessionId, snapshotIds: [fixture.result.snapshot.id] };
    expect(await authorizeSnapshotEviction(catalog.db, worker.token, inventory)).toEqual({
      snapshotIds: [],
    });
    const job = await next();
    await expect(
      catalog.pool.query("UPDATE jobs SET session_id=NULL WHERE id=$1", [job.jobId]),
    ).rejects.toMatchObject({ code: "23514" });
    await catalog.db.update(schema.scans).set({ state: "cancelled" });
    expect(await authorizeSnapshotEviction(catalog.db, worker.token, inventory)).toEqual({
      snapshotIds: [],
    });
    await abandonAttempt(catalog.db, worker.token, { ...attempt(job), cleanupConfirmed: true });
    expect(await authorizeSnapshotEviction(catalog.db, worker.token, inventory)).toEqual({
      snapshotIds: inventory.snapshotIds,
    });
    expect((await catalog.db.select().from(schema.preparations))[0]?.snapshotAvailable).toBe(false);
  });
  it("reconciles a missing local snapshot before accepting new claims", async () => {
    const fixture = await finishPreparation();
    await catalog.pool.query(
      "UPDATE workers SET last_seen_at=now()-interval '31 seconds' WHERE id=$1",
      [worker.workerId],
    );
    const sessionId = randomUUID();
    await readyWorker(catalog.db, worker.token, { sessionId, snapshotIds: [] });
    expect(await claimJob(catalog.db, worker.token, { sessionId })).toBeNull();
    await reconcileCatalog(catalog.db);
    expect(await scanProgress(catalog.db, fixture.scan.scanId)).toMatchObject({
      state: "failed_infrastructure",
    });
    expect((await catalog.db.select().from(schema.preparations))[0]?.snapshotAvailable).toBe(false);
  });
  it("retains the source manifest when omitted export labels contain NUL", async () => {
    await reserve();
    const job = await next();
    const result = prepared(job);
    const manifest = JSON.parse(result.manifestJson);
    manifest.exports["./invalid\u0000path"] = "./index.js";
    result.manifestJson = JSON.stringify(manifest);
    await submitJobResult(catalog.db, worker.token, { ...attempt(job), result });
    const stored = (await catalog.db.select().from(schema.preparations))[0];
    expect(stored?.installedManifest).toEqual(manifest);
    const scan = (await catalog.db.select().from(schema.scans))[0];
    expect(scan?.plan?.omissions.samples).toContainEqual({
      subpath: "./invalid?path",
      reason: "invalid_subpath",
    });
    expect(scan?.state).toBe("running");
  });
  it("records oversized plans for aggregation without blocking reconciliation", async () => {
    await reserve();
    const job = await next();
    const result = prepared(job);
    result.manifestJson = JSON.stringify({
      name: job.artifact.name,
      version: job.artifact.version,
      exports: Object.fromEntries(
        Array.from({ length: 512 }, (_, index) => [
          `./entry-${index}-${"a".repeat(1700)}`,
          `./${"b".repeat(1700)}.js`,
        ]),
      ),
    });
    await submitJobResult(catalog.db, worker.token, { ...attempt(job), result });
    await reconcileCatalog(catalog.db);
    expect((await catalog.db.select().from(schema.scans))[0]?.state).toBe("aggregating");
    expect(
      (await catalog.db.select().from(schema.jobs)).find((job) => job.kind === "aggregation")
        ?.attemptSummary,
    ).toMatchObject({ classification: "preparation_limit_exceeded", phase: "static_analysis" });
  });
  it("keeps queued scan snapshots pinned until the scan finishes", async () => {
    const fixture = await finishPreparation();
    expect(
      await workerSnapshotPins(catalog.db, worker.token, { sessionId: worker.sessionId }),
    ).toEqual([fixture.result.snapshot.id]);
    await catalog.db
      .update(schema.scans)
      .set({ state: "completed" })
      .where(eq(schema.scans.id, fixture.scan.scanId));
    expect(
      await workerSnapshotPins(catalog.db, worker.token, { sessionId: worker.sessionId }),
    ).toEqual([]);
  });
  it("does not allow a live session to be replaced or an old session to resume after expiry", async () => {
    await reserve();
    const job = await next();
    await expect(
      readyWorker(catalog.db, worker.token, { sessionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "worker_unavailable" });
    await catalog.pool.query(
      "UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [job.jobId],
    );
    await reconcileCatalog(catalog.db);
    await expect(
      readyWorker(catalog.db, worker.token, { sessionId: worker.sessionId }),
    ).rejects.toMatchObject({ code: "worker_unavailable" });
  });
  it("drains an idle disconnected worker and preserves the original scan deadline", async () => {
    const fixture = await finishPreparation();
    const original = await scanProgress(catalog.db, fixture.scan.scanId);
    await catalog.pool.query(
      "UPDATE workers SET last_seen_at=now()-interval '1 minute' WHERE id=$1",
      [worker.workerId],
    );
    await reconcileCatalog(catalog.db);
    await expect(
      claimJob(catalog.db, worker.token, { sessionId: worker.sessionId }),
    ).rejects.toMatchObject({ code: "worker_unavailable" });
    expect((await scanProgress(catalog.db, fixture.scan.scanId))?.deadlineAt).toEqual(
      original?.deadlineAt,
    );
    await catalog.pool.query(
      "UPDATE scans SET started_at=now()-interval '20 minutes',deadline_at=now()-interval '1 second' WHERE id=$1",
      [fixture.scan.scanId],
    );
    await reconcileCatalog(catalog.db);
    expect(await scanProgress(catalog.db, fixture.scan.scanId)).toMatchObject({
      state: "inconclusive",
    });
    expect(
      (await catalog.db.select().from(schema.jobs))
        .filter((job) => job.kind !== "aggregation")
        .every((job) => job.state === "finished"),
    ).toBe(true);
  });
  it("stores only token hashes and rejects revoked or incorrectly scoped workers", async () => {
    const rows = await catalog.db.select().from(schema.workers);
    expect(rows[0]?.tokenHash).toBe(hash(worker.token));
    expect(JSON.stringify(await catalog.db.select().from(schema.auditEvents))).not.toContain(
      worker.token,
    );
    await expect(
      claimJob(catalog.db, `clw_${"a".repeat(43)}`, { sessionId: worker.sessionId }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      claimJob(catalog.db, worker.token, { sessionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "worker_unavailable" });
    await catalog.db.update(schema.workers).set({ revokedAt: new Date() });
    await expect(
      readyWorker(catalog.db, worker.token, { sessionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("claims one preparation exactly once under thirty concurrent requests", async () => {
    await reserve();
    const claims = await concurrent(
      Array.from({ length: 30 }, () =>
        claimJob(catalog.db, worker.token, { sessionId: worker.sessionId }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = (await catalog.db.select().from(schema.jobs))[0];
    expect(job).toMatchObject({ state: "leased", attempt: 1, workerId: worker.workerId });
    expect(claims.find(Boolean)?.lease.remainingMs).toBeLessThanOrEqual(30_000);
  });
  it("accepts a preparation atomically and deduplicates identical submissions", async () => {
    await reserve();
    const job = await next();
    const result = prepared(job);
    const responses = await concurrent(
      Array.from({ length: 12 }, () =>
        submitJobResult(catalog.db, worker.token, { ...attempt(job), result }),
      ),
    );
    expect(responses.filter((response) => !response.duplicate)).toHaveLength(1);
    expect(await catalog.db.select().from(schema.runs)).toHaveLength(16);
    expect((await catalog.db.select().from(schema.preparations))[0]).toMatchObject({
      state: "ready",
      snapshotId: result.snapshot.id,
      snapshotGeneration: result.snapshot.generation,
      ownerWorkerId: worker.workerId,
      lockDigest: result.snapshot.lockDigest,
    });
    await expect(
      submitJobResult(catalog.db, worker.token, {
        ...attempt(job),
        result: { ...result, snapshot: { ...result.snapshot, treeDigest: hash("changed") } },
      }),
    ).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("routes every run to its snapshot owner and creates one aggregation job", async () => {
    const fixture = await finishPreparation();
    const other = await createWorker();
    expect(await claimJob(catalog.db, other.token, { sessionId: other.sessionId })).toBeNull();
    for (let index = 0; index < 16; index++) {
      const job = await next();
      expect(job.kind).toBe("run");
      await renewJob(catalog.db, worker.token, attempt(job));
      await submitJobResult(catalog.db, worker.token, {
        ...attempt(job),
        result: { kind: "run", evidence: runEvidence(job) },
      });
    }
    await reconcileCatalog(catalog.db);
    await reconcileCatalog(catalog.db);
    const progress = await scanProgress(catalog.db, fixture.scan.scanId);
    expect(progress).toMatchObject({
      state: "aggregating",
      jobs: { finished: 17, queued: 1, active: 0 },
    });
    expect(progress?.revision).toBeGreaterThan(16);
    const rows = await catalog.db.select().from(schema.runs);
    expect(rows.every((row) => row.rawEvidence && row.logs && row.logsExpireAt)).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.rawEvidence))).not.toContain("fixture output");
    expect(JSON.stringify(rows.map((row) => row.logs))).toContain("fixture output");
  });
  it("retains bounded logs containing NUL and freezes the accepted snapshot metadata", async () => {
    const fixture = await finishPreparation();
    const job = await next();
    const evidence = runEvidence(job);
    const session = evidence.sessions[0];
    if (!session) throw new Error("Expected authored session.");
    session.logs.stdout = "before\u0000after";
    session.logs.emittedBytes = Buffer.byteLength(session.logs.stdout);
    await submitJobResult(catalog.db, worker.token, {
      ...attempt(job),
      result: { kind: "run", evidence },
    });
    const rows = await catalog.db.select().from(schema.runs);
    expect(JSON.stringify(rows.map((row) => row.logs))).toContain("before?after");
    expect(JSON.stringify(rows.map((row) => row.logs))).toContain("nul_replacement_v1");
    await expect(
      catalog.pool.query("UPDATE preparations SET installed_manifest=$1 WHERE id=$2", [
        { name: "changed" },
        fixture.scan.preparationId,
      ]),
    ).rejects.toThrow("immutable preparation inputs");
    await expect(
      catalog.pool.query("UPDATE preparations SET snapshot_id=gen_random_uuid() WHERE id=$1", [
        fixture.scan.preparationId,
      ]),
    ).rejects.toThrow("immutable preparation inputs");
  });
  it("rejects another worker, stale tokens, expired results and policy changes", async () => {
    const fixture = await reserve();
    const job = await next();
    const other = await createWorker();
    const result = prepared(job);
    await expect(
      submitJobResult(catalog.db, other.token, { ...attempt(job, other.sessionId), result }),
    ).rejects.toMatchObject({ code: "stale_attempt" });
    await expect(
      renewJob(catalog.db, worker.token, { ...attempt(job), attemptToken: randomUUID() }),
    ).rejects.toMatchObject({ code: "stale_attempt" });
    await blockSubject(catalog.db, "package", fixture.source.name, actor);
    await expect(renewJob(catalog.db, worker.token, attempt(job))).rejects.toMatchObject({
      code: "stale_attempt",
    });
    await expect(
      submitJobResult(catalog.db, worker.token, { ...attempt(job), result }),
    ).rejects.toMatchObject({ code: "stale_attempt" });
    await catalog.pool.query(
      "UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [job.jobId],
    );
    await expect(
      submitJobResult(catalog.db, worker.token, { ...attempt(job), result }),
    ).rejects.toMatchObject({ code: "stale_attempt" });
  });
  it("holds expired capacity until confirmed cleanup and fences the previous attempt", async () => {
    await reserve();
    const job = await next();
    await catalog.pool.query(
      "UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [job.jobId],
    );
    await reconcileCatalog(catalog.db);
    expect((await catalog.db.select().from(schema.jobs))[0]).toMatchObject({
      state: "leased",
      cleanupRequired: true,
    });
    expect((await catalog.db.select().from(schema.workers))[0]).toMatchObject({
      state: "drained",
      recoveryRequired: true,
    });
    const other = await createWorker();
    expect(await claimJob(catalog.db, other.token, { sessionId: other.sessionId })).toBeNull();
    const sessionId = randomUUID();
    await readyWorker(catalog.db, worker.token, { sessionId });
    const replacement = await next({ ...worker, sessionId });
    expect(replacement.attempt).toBe(2);
    expect(replacement.attemptToken).not.toBe(job.attemptToken);
    await expect(
      submitJobResult(catalog.db, worker.token, { ...attempt(job), result: prepared(job) }),
    ).rejects.toMatchObject({ code: "stale_attempt" });
  });
  it("backs off infrastructure retries twice and never retries preparation failures", async () => {
    const fixture = await reserve();
    const first = await next();
    for (let index = 1; index <= 3; index++) {
      const job = index === 1 ? first : await next();
      expect(job.attempt).toBe(index);
      await submitJobResult(catalog.db, worker.token, {
        ...attempt(job),
        result: {
          kind: "failure",
          origin: "infrastructure",
          classification: "runner_unavailable",
          message: "Fixture infrastructure failure.",
        },
      });
      expect(await claimJob(catalog.db, worker.token, { sessionId: worker.sessionId })).toBeNull();
      await catalog.pool.query(
        "UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",
        [job.jobId],
      );
    }
    expect(await scanProgress(catalog.db, fixture.scan.scanId)).toMatchObject({
      state: "aggregating",
    });
    expect((await catalog.db.select().from(schema.preparations))[0]?.state).toBe(
      "failed_infrastructure",
    );
    await reserve();
    const packageJob = await next();
    await submitJobResult(catalog.db, worker.token, {
      ...attempt(packageJob),
      result: {
        kind: "failure",
        origin: "preparation",
        classification: "dependency_install_failed",
        message: "Fixture package failure.",
      },
    });
    expect(
      (await catalog.db.select().from(schema.jobs).where(eq(schema.jobs.id, packageJob.jobId)))[0],
    ).toMatchObject({ state: "finished", attempt: 1 });
  });
  it("rejects changed locks and inconsistent run evidence without completing the job", async () => {
    await reserve();
    const job = await next();
    const result = prepared(job);
    await expect(
      submitJobResult(catalog.db, worker.token, {
        ...attempt(job),
        result: { ...result, snapshot: { ...result.snapshot, lockDigest: hash("wrong") } },
      }),
    ).rejects.toMatchObject({ code: "invalid_result" });
    expect((await catalog.db.select().from(schema.preparations))[0]?.state).toBe("preparing");
    await submitJobResult(catalog.db, worker.token, { ...attempt(job), result });
    const run = await next();
    const evidence = runEvidence(run);
    evidence.coverage.observed = 0;
    await expect(
      submitJobResult(catalog.db, worker.token, {
        ...attempt(run),
        result: { kind: "run", evidence },
      }),
    ).rejects.toMatchObject({ code: "invalid_result" });
    expect(
      (await catalog.db.select().from(schema.jobs).where(eq(schema.jobs.id, run.jobId)))[0]?.state,
    ).toBe("leased");
  });
  it("prioritizes another scan and respects global and per-image capacity", async () => {
    const first = await finishPreparation();
    const firstRun = await next();
    const second = await reserve();
    const secondPreparation = await next();
    expect(secondPreparation.scanId).toBe(second.scan.scanId);
    await submitJobResult(catalog.db, worker.token, {
      ...attempt(secondPreparation),
      result: prepared(secondPreparation),
    });
    const secondRun = await next();
    expect(firstRun.scanId).toBe(first.scan.scanId);
    expect(secondRun.scanId).toBe(second.scan.scanId);
    const third = await next();
    expect(await claimJob(catalog.db, worker.token, { sessionId: worker.sessionId })).toBeNull();
    const images = [firstRun, secondRun, third].map((job) =>
      job.kind === "run" ? job.image.imageId : "",
    );
    for (const image of images)
      expect(images.filter((value) => value === image).length).toBeLessThanOrEqual(2);
  });
  it("stops cancelled work and releases it only after cleanup acknowledgement", async () => {
    const fixture = await reserve();
    const job = await next();
    await catalog.db
      .update(schema.scans)
      .set({ state: "cancelled", finishedAt: new Date() })
      .where(eq(schema.scans.id, fixture.scan.scanId));
    await expect(renewJob(catalog.db, worker.token, attempt(job))).rejects.toMatchObject({
      code: "stale_attempt",
    });
    await abandonAttempt(catalog.db, worker.token, { ...attempt(job), cleanupConfirmed: true });
    expect((await catalog.db.select().from(schema.jobs))[0]).toMatchObject({
      state: "finished",
      cleanupRequired: false,
    });
    expect(await scanProgress(catalog.db, fixture.scan.scanId)).toMatchObject({
      state: "cancelled",
    });
  });
});

it("authenticates and validates private HTTP requests without exposing request contents", async () => {
  const server = createControlServer(catalog.db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${address}/v1/jobs/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: worker.sessionId }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    const origin = await fetch(`${address}/v1/jobs/claim`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${worker.token}`,
        "content-type": "application/json",
        origin: "https://public.example",
      },
      body: JSON.stringify({ sessionId: worker.sessionId }),
    });
    expect(origin.status).toBe(400);
    const client = new ControlClient(address, worker.token);
    await expect(
      client.post("/v1/workers/ready", { sessionId: worker.sessionId }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await client.post("/v1/jobs/claim", { sessionId: worker.sessionId })).toEqual({
      job: null,
      snapshotIds: [],
    });
    await reserve();
    expect(await client.post("/v1/jobs/claim", { sessionId: worker.sessionId })).toMatchObject({
      job: { kind: "preparation", schemaVersion: 1 },
    });
    await expect(
      client.post("/v1/jobs/renew", { unexpected: "secret-value" }),
    ).rejects.toMatchObject({ status: 400 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
