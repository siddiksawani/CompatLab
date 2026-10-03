import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  admitScan,
  aggregatePendingReports,
  createReportApi,
  migrateCatalog,
  openCatalog,
  reconcileCatalog,
  registerMatrix,
  registerRuntime,
  registerWorker,
  scanProgress,
} from "../packages/catalog/dist/index.js";
import {
  CLASSIFIER_REVISION,
  hostedReportSchema,
  PREPARATION_PROFILE_REVISION,
} from "../packages/contracts/dist/index.js";
import { RegistryClient } from "../packages/engine/dist/index.js";
import { createControlServer } from "../services/control/dist/server.js";
import {
  buildRuntimeImages,
  collectSnapshots,
  recoverResources,
} from "../services/worker/dist/index.js";

if (process.geteuid?.() !== 0 || process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Corpus qualification requires Linux amd64/runsc as root.");
const shard = Number(process.argv[2]);
assert.ok(Number.isInteger(shard) && shard >= 0 && shard < 10, "Select corpus shard 0–9.");
const corpus = JSON.parse(await readFile("fixtures/corpus/public-v1.json", "utf8"));
assert.equal(corpus.length, 100);
assert.equal(new Set(corpus.map((row) => `${row.name}@${row.version}`)).size, 100);
const selected = corpus.filter((_, index) => index % 10 === shard);
const url = new URL(process.env.COMPATLAB_TEST_DATABASE_URL ?? "");
assert.match(url.pathname, /^\/compatlab_test(?:_[a-z0-9_]+)?$/);
const admin = openCatalog(url.href),
  database = `compatlab_test_corpus_${randomUUID().replaceAll("-", "")}`;
await admin.pool.query(`CREATE DATABASE "${database}"`);
url.pathname = database;
const catalog = openCatalog(url.href),
  base = await mkdtemp(join(tmpdir(), "compatlab-corpus-")),
  state = join(base, "worker");
const output = resolve(`test-results/corpus-${shard}`);
await mkdir(output, { recursive: true });
const actor = {
  actor: "qualification",
  reason: "Public corpus on a disposable qualified execution host.",
};
let server,
  child,
  exited,
  workerFailure,
  tail = "",
  shutdownFailure;
const results = [];
try {
  await mkdir(state, { mode: 0o700 });
  await migrateCatalog(catalog.pool);
  const images = await buildRuntimeImages(),
    imageIds = [];
  for (const image of images) imageIds.push(await registerRuntime(catalog.db, image, actor));
  const matrixId = await registerMatrix(
    catalog.db,
    {
      revision: "public_corpus_v1",
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
  const token = join(base, "token");
  await writeFile(token, worker.token, { mode: 0o600 });
  server = createControlServer(catalog.db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  child = spawn(process.execPath, [resolve("services/worker/dist/remote/bin.js")], {
    env: {
      PATH: process.env.PATH,
      HOME: base,
      CONTROL_URL: `http://127.0.0.1:${server.address().port}`,
      WORKER_TOKEN_FILE: token,
      WORKER_STATE_DIRECTORY: state,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-16_384);
    });
  exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  child.once("error", (error) => {
    workerFailure = error;
  });
  const registry = new RegistryClient(),
    api = createReportApi(catalog.db);
  for (const [index, pinned] of selected.entries()) {
    const started = performance.now(),
      artifact = await registry.resolve(pinned.name, pinned.version);
    assert.equal(artifact.integrity, pinned.integrity, "Pinned public artifact integrity changed.");
    const admission = await admitScan(catalog.db, artifact, {
      matrixId,
      requesterKey: randomUUID().replaceAll("-", "").repeat(2),
      classifierRevision: CLASSIFIER_REVISION,
    });
    assert.equal(admission.kind, "admitted");
    const deadline = Date.now() + 960_000;
    let progress;
    do {
      if (workerFailure) throw workerFailure;
      assert.ok(child.exitCode === null && child.signalCode === null, `Worker exited: ${tail}`);
      assert.ok(Date.now() < deadline, `Corpus scan timed out: ${pinned.name}`);
      await reconcileCatalog(catalog.db);
      await aggregatePendingReports(catalog.db);
      progress = await scanProgress(catalog.db, admission.scanId);
      if (!progress?.reportId) await sleep(250);
    } while (!progress?.reportId);
    const response = await api(new Request(`http://localhost/api/v1/reports/${progress.reportId}`));
    assert.equal(response.status, 200);
    const envelope = await response.json(),
      report = hostedReportSchema.parse(envelope.report);
    assert.equal(report.matrix.images.length, 4);
    assert.equal(report.cells.length, 16);
    assert.equal(report.artifact.integrity, pinned.integrity);
    assert.ok(report.observedAt);
    const infrastructure =
      report.preparation.failure?.origin === "infrastructure" ||
      report.cells.some((cell) => cell.failure?.origin === "infrastructure");
    await writeFile(
      join(output, `${index}-${pinned.name.replaceAll("/", "-")}.json`),
      JSON.stringify(envelope),
    );
    const summary = {
      name: pinned.name,
      version: pinned.version,
      reportId: report.id,
      outcome: report.outcome,
      coverageComplete: report.coverageComplete,
      preparation: report.preparation.outcome,
      preparationFailure: report.preparation.failure?.classification ?? null,
      infrastructure,
      elapsedMs: Math.round(performance.now() - started),
      queueMs: progress.startedAt
        ? new Date(progress.startedAt).getTime() - new Date(progress.requestedAt).getTime()
        : null,
      cells: report.cells.map((cell) => ({
        profile: cell.profileId,
        mode: cell.mode,
        group: cell.group,
        outcome: cell.outcome,
        durationMs: cell.durationMs,
        coverage: cell.coverage,
        failure: cell.failure?.classification ?? null,
      })),
    };
    results.push(summary);
    process.stdout.write(
      `${JSON.stringify({ name: pinned.name, version: pinned.version, outcome: report.outcome, infrastructure, elapsedMs: summary.elapsedMs })}\n`,
    );
    assert.equal(
      infrastructure,
      false,
      `Infrastructure failure needs investigation: ${pinned.name}`,
    );
  }
} finally {
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      { schemaVersion: 1, shard, observedAt: new Date().toISOString(), results },
      null,
      2,
    ),
  );
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const status = await exited;
    clearTimeout(timer);
    if (status.code !== 0) shutdownFailure = new Error(`Worker shutdown failed: ${tail}`);
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
if (shutdownFailure) throw shutdownFailure;
assert.equal(results.length, 10);
