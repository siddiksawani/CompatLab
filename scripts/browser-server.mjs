import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { assertionResult, seedAssertion } from "../fixtures/browser/assertions.mjs";
import { prepared, runEvidence } from "../packages/catalog/.browser-fixtures/execution-fixtures.js";
import {
  actor,
  database,
  image,
  migrateCatalog,
  seedMatrix,
} from "../packages/catalog/.browser-fixtures/fixtures.js";
import {
  aggregatePendingReports,
  claimJob,
  invalidateReport,
  readyWorker,
  reconcileCatalog,
  registerWorker,
  submitJobResult,
} from "../packages/catalog/dist/index.js";
import { PREPARATION_PROFILE_REVISION } from "../packages/contracts/dist/index.js";

await cp(
  resolve("apps/web/.next/static"),
  resolve("apps/web/.next/standalone/apps/web/.next/static"),
  { recursive: true },
);
const catalog = await database();
await migrateCatalog(catalog.pool);
const matrix = await seedMatrix(catalog.db);
const owner = await registerWorker(
  catalog.db,
  {
    platform: "linux_amd64_glibc",
    assertionRevision: "assertion_v1",
    preparationProfiles: [PREPARATION_PROFILE_REVISION],
    imageDigests: [0, 1, 2, 3].map((index) => image(index).imageId),
    harnessRevision: "load_v2",
    planRevision: "explicit_exports_v1",
    policyRevision: "runtime_limits_v2",
  },
  3,
  actor,
);
let sessionId = randomUUID();
await readyWorker(catalog.db, owner.token, { sessionId, snapshotIds: [] });
let busy = false;
const fixtureServer = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (
    request.method !== "POST" ||
    request.headers["x-compatlab-fixture"] !== "browser_v1" ||
    busy
  ) {
    response.writeHead(403).end("{}");
    return;
  }
  busy = true;
  try {
    if (request.url === "/reset") {
      await catalog.pool.query(
        "TRUNCATE auth_users,probe_revisions,audit_events,blocks,reports,jobs,runs,scans,preparations,package_versions,packages CASCADE",
      );
    } else if (["/execute", "/execute-mixed", "/execute-optional-peers"].includes(request.url)) {
      const mixed = request.url === "/execute-mixed";
      const optionalPeers = request.url === "/execute-optional-peers";
      sessionId = randomUUID();
      await catalog.pool.query(
        "UPDATE workers SET recovery_required=true,state='drained',session_id=NULL",
      );
      const snapshots = (
        await catalog.pool.query(
          "SELECT snapshot_id FROM preparations WHERE owner_worker_id=$1 AND snapshot_available",
          [owner.workerId],
        )
      ).rows;
      await readyWorker(catalog.db, owner.token, {
        sessionId,
        snapshotIds: snapshots.map((row) => row.snapshot_id),
      });
      for (let count = 0; count < 64; count++) {
        const job = await claimJob(catalog.db, owner.token, { sessionId });
        if (!job) break;
        let result;
        if (job.kind === "preparation") {
          result = prepared(job);
          result.manifestJson = JSON.stringify({
            name: job.artifact.name,
            version: job.artifact.version,
            exports: {
              ".": "./index.js",
              "./util": "./util.js",
              ...(mixed || optionalPeers ? { "./missing": "./missing.js" } : {}),
            },
            ...(optionalPeers
              ? {
                  peerDependencies: { "@fixture/renderer": "^2.0.0" },
                  peerDependenciesMeta: { "@fixture/renderer": { optional: true } },
                }
              : {}),
          });
        } else if (job.kind === "assertion") result = assertionResult(job);
        else {
          const evidence = runEvidence(job);
          if ((mixed || optionalPeers) && job.group === "subpaths") {
            evidence.observations[1] = {
              index: 1,
              outcome: "fail",
              durationMs: 1,
              resolvedTo: null,
              error: {
                name: "Error",
                code: "ERR_MODULE_NOT_FOUND",
                message: optionalPeers
                  ? "Cannot find package '@fixture/renderer' imported from /workspace/node_modules/fixture/missing.js"
                  : "Authored missing export fixture.",
              },
            };
          }
          for (const session of evidence.sessions)
            session.logs.stdout =
              "\u001b[31m<script>window.packageCodeExecuted=true</script>\u001b[0m";
          result = { kind: "run", evidence };
        }
        await submitJobResult(catalog.db, owner.token, {
          sessionId,
          jobId: job.jobId,
          attemptToken: job.attemptToken,
          result,
        });
      }
      await reconcileCatalog(catalog.db);
      await aggregatePendingReports(catalog.db);
    } else if (request.url === "/assertion") {
      const scanId = await seedAssertion(catalog);
      await reconcileCatalog(catalog.db);
      response.end(JSON.stringify({ scanId }));
      return;
    } else if (request.url === "/invalidate") {
      const rows = (await catalog.pool.query("SELECT id FROM reports")).rows;
      for (const row of rows)
        await invalidateReport(catalog.db, row.id, {
          ...actor,
          reason: "Browser invalidation fixture.",
        });
    } else if (request.url === "/expire-logs") {
      await catalog.pool.query("UPDATE runs SET logs_expire_at=now()-interval '1 day'");
    } else if (request.url === "/counts") {
      const result = await catalog.pool.query(
        "SELECT (SELECT count(*)::int FROM scans) AS scans,(SELECT count(*)::int FROM jobs) AS jobs",
      );
      response.end(JSON.stringify(result.rows[0]));
      return;
    } else {
      response.writeHead(404).end("{}");
      return;
    }
    response.end('{"ok":true}');
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    response.writeHead(500).end('{"error":"fixture_failed"}');
  } finally {
    busy = false;
  }
});
await new Promise((resolve) => fixtureServer.listen(3878, "127.0.0.1", resolve));
const child = spawn(
  process.execPath,
  [
    "--import",
    resolve("fixtures/browser/registry.mjs"),
    resolve("apps/web/.next/standalone/apps/web/server.js"),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: "3877",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: catalog.address,
      PUBLIC_ORIGIN: "http://127.0.0.1:3877",
      PUBLIC_MATRIX_ID: matrix.matrixId,
      REQUESTER_SECRET: "a".repeat(64),
      PUBLIC_SCANS_ENABLED: "true",
      PROXY_SECRET: "",
    },
  },
);
const exited = new Promise((resolve) => child.once("exit", resolve));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  await exited;
  fixtureServer.closeAllConnections();
  await new Promise((resolve) => fixtureServer.close(resolve));
  await catalog.dispose();
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
child.once("exit", () => {
  if (!stopping) void stop();
});
