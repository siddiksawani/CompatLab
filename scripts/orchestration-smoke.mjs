import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { PREPARATION_PROFILE_REVISION } from "../packages/contracts/dist/index.js";
import {
  assertionDigest,
  RegistryClient,
  validateAssertionBundle,
} from "../packages/engine/dist/index.js";
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
let shutdownFailure;
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
      assertionRevision: "assertion_v1",
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
  const source = Buffer.from(
      "import isNumber from 'is-number'; export default ()=>{if(!isNumber(42))throw Error('Expected a number')}",
    ),
    blobSha = createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex");
  const assertion = validateAssertionBundle({
    schemaVersion: 1,
    harnessRevision: "assertion_v1",
    policyRevision: "runtime_limits_v2",
    repository: "owner/package",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    manifestPath: "manifest.json",
    manifest: {
      schemaVersion: 1,
      name: "number-behavior",
      packageName: artifact.name,
      packageRange: "*",
      entry: "probe.mjs",
      timeoutMs: 10000,
      capabilities: {
        network: "none",
        filesystem: "read_only_workspace_and_bounded_temporary_output",
        processes: "bounded",
      },
      fixtures: [],
      expectedBehavior: "42 is recognized as a number.",
    },
    files: [
      {
        path: "probe.mjs",
        base64: source.toString("base64"),
        sha256: createHash("sha256").update(source).digest("hex"),
        gitBlobSha: blobSha,
      },
    ],
  });
  const userId = randomUUID(),
    linkId = randomUUID(),
    revisionId = randomUUID(),
    parentId = randomUUID();
  await catalog.pool.query(
    "INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,'qualification','qualification@example.com',true)",
    [userId],
  );
  await catalog.pool.query(
    "INSERT INTO repository_links(id,user_id,repository_id,installation_id,full_name) VALUES($1,$2,'51','9','owner/package')",
    [linkId, userId],
  );
  await catalog.pool.query(
    "INSERT INTO probe_revisions(id,owner_user_id,repository_link_id,digest,bundle) VALUES($1,$2,$3,$4,$5)",
    [revisionId, userId, linkId, assertionDigest(assertion), JSON.stringify(assertion)],
  );
  const packageId = (
    await catalog.pool.query("INSERT INTO packages(name) VALUES($1) RETURNING id", [artifact.name])
  ).rows[0].id;
  const artifactId = (
    await catalog.pool.query(
      "INSERT INTO package_versions(package_id,version,integrity,tarball_url,manifest) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        packageId,
        artifact.version,
        artifact.integrity,
        artifact.tarballUrl,
        JSON.stringify(artifact.manifest),
      ],
    )
  ).rows[0].id;
  const prepId = (
    await catalog.pool.query(
      "INSERT INTO preparations(artifact_id,profile_revision,platform) VALUES($1,$2,'linux_amd64_glibc') RETURNING id",
      [artifactId, PREPARATION_PROFILE_REVISION],
    )
  ).rows[0].id;
  await catalog.pool.query(
    "INSERT INTO scans(id,preparation_id,matrix_id,state,requester_expires_at,admission_policy,requested_at) VALUES($1,$2,$3,'cancelled',now()+interval '1 day','admission_v4',now()-interval '1 day')",
    [parentId, prepId, matrixId],
  );
  await catalog.pool.query(
    "INSERT INTO jobs(kind,scan_id,preparation_id,state) VALUES('preparation',$1,$2,'finished')",
    [parentId, prepId],
  );
  const scan = await admitScan(catalog.db, artifact, {
    rescan: { previousScanId: parentId, assertionRevisionId: revisionId },
    matrixId,
    requesterKey: "a".repeat(64),
    classifierRevision: "classifier_v1",
  });
  assert.equal(scan.kind, "admitted");
  await reconcileCatalog(catalog.db);
  await aggregatePendingReports(catalog.db);
  function startWorker() {
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
    exit = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    child.once("error", (error) => {
      failure = error;
    });
  }
  startWorker();
  let restarted = false;
  let retainedSnapshot;
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Worker exited before completion: ${output}`);
    await reconcileCatalog(catalog.db);
    const progress = await scanProgress(catalog.db, scan.scanId);
    if (progress?.state === "aggregating") break;
    if (!restarted && progress?.state === "running") {
      const active = (
        await catalog.pool.query(
          "SELECT count(*)::int AS count FROM jobs WHERE scan_id=$1 AND kind='run' AND state IN ('leased','running')",
          [scan.scanId],
        )
      ).rows[0].count;
      if (active > 0) {
        retainedSnapshot = (
          await catalog.pool.query("SELECT snapshot_id FROM preparations WHERE id=$1", [
            scan.preparationId,
          ])
        ).rows[0].snapshot_id;
        child.kill("SIGKILL");
        await exit;
        await sleep(31_000);
        await reconcileCatalog(catalog.db);
        const reserved = (
          await catalog.pool.query(
            "SELECT count(*)::int AS count FROM jobs WHERE scan_id=$1 AND state IN ('leased','running') AND cleanup_required",
            [scan.scanId],
          )
        ).rows[0].count;
        assert.ok(reserved > 0, "Worker death must hold expired capacity until startup cleanup.");
        startWorker();
        restarted = true;
      }
    }
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
    await catalog.pool.query(
      "SELECT raw_evidence FROM runs WHERE scan_id=$1 AND assertion_revision_id IS NULL",
      [scan.scanId],
    )
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
  assert.ok(restarted, "The qualification must interrupt and replace a live worker.");
  assert.equal(preparation.snapshot_id, retainedSnapshot);
  const aggregation = (
    await catalog.pool.query(
      "SELECT count(*)::int AS count FROM jobs WHERE scan_id=$1 AND kind='aggregation'",
      [scan.scanId],
    )
  ).rows[0];
  assert.equal(aggregation.count, 1);
  assert.deepEqual(await aggregatePendingReports(catalog.db), { completed: 1, failed: 0 });
  const completed = await scanProgress(catalog.db, scan.scanId);
  assert.equal(completed.state, "completed");
  const api = createReportApi(catalog.db);
  const reportUrl = `http://localhost/api/v1/reports/${completed.reportId}`;
  const { report, status } = await (await api(new Request(reportUrl))).json();
  assert.equal(status.current, true);
  assert.equal(report.outcome, "pass");
  assert.equal(report.cells.length, images.length * 4);
  assert.equal(report.preparation.snapshot.id, retainedSnapshot);
  assert.equal(report.evidenceLevel, "smoke_tested");
  assert.equal(report.assertions.length, 1);
  assert.ok(
    report.assertions[0].cells.every(
      (cell) => cell.outcome === "pass" && cell.evidenceLevel === "probe_verified",
    ),
  );
  assert.equal(report.assertions[0].definition.digest, assertionDigest(assertion));
  const lock = await api(new Request(`${reportUrl}/lock`));
  assert.equal(lock.status, 200);
  assert.equal(lock.headers.get("x-content-sha256"), preparation.lock_digest);
  const inputs = await (await api(new Request(`${reportUrl}/reproduction`))).json();
  assert.equal(inputs.kind, "reproduction_inputs");
  assert.equal(inputs.snapshot.id, retainedSnapshot);
  assert.deepEqual(inputs.assertion, assertion);
  process.stdout.write(
    "Private API -> authenticated worker -> sealed preparation -> worker death and recovery -> 16 automatic groups + 4 named assertions -> stored report and reproduction downloads: qualified\n",
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const status = await exit;
    clearTimeout(timer);
    if (status.code !== 0)
      shutdownFailure = new Error(`Worker shutdown: ${JSON.stringify(status)} ${output}`);
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
