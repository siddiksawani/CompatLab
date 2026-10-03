import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  admitScan,
  migrateCatalog,
  openCatalog,
  reconcileCatalog,
  registerMatrix,
  registerRuntime,
  registerWorker,
  scanProgress,
} from "../packages/catalog/dist/index.js";
import { PREPARATION_PROFILE_REVISION } from "../packages/contracts/dist/index.js";
import { RegistryClient } from "../packages/engine/dist/index.js";
import { createControlServer } from "../services/control/dist/server.js";
import {
  buildRuntimeImages,
  collectSnapshots,
  recoverResources,
} from "../services/worker/dist/index.js";

if (process.geteuid?.() !== 0 || process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Orchestration qualification requires a disposable Linux amd64/runsc host.");
const url = new URL(process.env.COMPATLAB_TEST_DATABASE_URL ?? "");
if (!/^\/compatlab_test(?:_[a-z0-9_]+)?$/.test(url.pathname))
  throw new Error("Use a disposable test database.");
const admin = openCatalog(url.href);
const database = `compatlab_test_orchestration_${randomUUID().replaceAll("-", "")}`;
await admin.pool.query(`CREATE DATABASE "${database}"`);
url.pathname = database;
const catalog = openCatalog(url.href);
const base = await mkdtemp(join(tmpdir(), "compatlab-orchestration-"));
const state = join(base, "worker");
const actor = { actor: "qualification", reason: "Disposable private worker integration test." };
let server;
let child;
let exit;
let output = "";
let failure;
try {
  await mkdir(state, { mode: 0o700 });
  await migrateCatalog(catalog.pool);
  const images = await buildRuntimeImages();
  const imageIds = [];
  for (const image of images) imageIds.push(await registerRuntime(catalog.db, image, actor));
  const matrixId = await registerMatrix(
    catalog.db,
    {
      revision: "orchestration_v1",
      preparationProfile: PREPARATION_PROFILE_REVISION,
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
      imageIds,
    },
    actor,
  );
  const worker = await registerWorker(
    catalog.db,
    {
      platform: "linux_amd64_glibc",
      preparationProfiles: [PREPARATION_PROFILE_REVISION],
      imageDigests: images.map((image) => image.imageId),
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
    },
    3,
    actor,
  );
  const tokenFile = join(base, "worker-token");
  await writeFile(tokenFile, worker.token, { mode: 0o600 });
  await mkdir(join(base, "home"), { mode: 0o700 });
  server = createControlServer(catalog.db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controlUrl = `http://127.0.0.1:${server.address().port}`;
  const artifact = await new RegistryClient().resolve("is-number", "7.0.0");
  const scan = await admitScan(catalog.db, artifact, {
    matrixId,
    requesterKey: "a".repeat(64),
    classifierRevision: "classifier_v1",
  });
  assert.equal(scan.kind, "admitted");
  child = spawn(process.execPath, [resolve("services/worker/dist/remote/bin.js")], {
    env: {
      PATH: process.env.PATH,
      HOME: join(base, "home"),
      CONTROL_URL: controlUrl,
      WORKER_TOKEN_FILE: tokenFile,
      WORKER_STATE_DIRECTORY: state,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-16_384);
    });
  exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  child.once("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Worker exited before completion: ${output}`);
    await reconcileCatalog(catalog.db);
    const progress = await scanProgress(catalog.db, scan.scanId);
    if (progress?.state === "aggregating") break;
    assert.ok(
      progress &&
        !["failed_infrastructure", "rejected", "cancelled", "inconclusive"].includes(
          progress.state,
        ),
      JSON.stringify(progress),
    );
    assert.ok(Date.now() < deadline, "Private worker execution timed out.");
    await sleep(500);
  }
  const runs = (
    await catalog.pool.query("SELECT raw_evidence FROM runs WHERE scan_id=$1", [scan.scanId])
  ).rows;
  assert.equal(runs.length, images.length * 4);
  for (const { raw_evidence: evidence } of runs) {
    assert.equal(evidence.coverage.complete, true, JSON.stringify(evidence));
    assert.ok(evidence.observations.every((entry) => entry.outcome === "pass"));
  }
  const preparation = (
    await catalog.pool.query(
      "SELECT snapshot_id,lock_digest,owner_worker_id FROM preparations WHERE id=$1",
      [scan.preparationId],
    )
  ).rows[0];
  assert.equal(preparation.owner_worker_id, worker.workerId);
  assert.match(preparation.lock_digest, /^[a-f0-9]{64}$/);
  assert.ok(preparation.snapshot_id);
  const aggregation = (
    await catalog.pool.query(
      "SELECT count(*)::int AS count FROM jobs WHERE scan_id=$1 AND kind='aggregation'",
      [scan.scanId],
    )
  ).rows[0];
  assert.equal(aggregation.count, 1);
  process.stdout.write(
    "Private API -> authenticated worker -> sealed preparation -> 16 accepted runtime groups -> aggregation: qualified\n",
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const status = await exit;
    clearTimeout(timer);
    if (status.code !== 0)
      process.stderr.write(`Worker shutdown: ${JSON.stringify(status)} ${output}\n`);
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await recoverResources(state);
  await collectSnapshots(state, new Set(), 0);
  await rm(base, { recursive: true, force: true });
  await catalog.close();
  await admin.pool.query(`DROP DATABASE "${database}"`);
  await admin.close();
}
