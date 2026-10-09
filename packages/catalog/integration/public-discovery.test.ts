import {
  CLASSIFIER_REVISION,
  packageResponseSchema,
  searchResponseSchema,
} from "@compatlab/contracts";
import { RegistryClient } from "@compatlab/engine";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  ADMISSION_POLICY,
  createPublicApi,
  invalidateReport,
  migrateCatalog,
  registerMatrix,
  schema,
} from "../src/index.js";
import {
  actor,
  artifact,
  database,
  hash,
  matrix,
  readyPreparation,
  seedMatrix,
  seedOldScan,
} from "./fixtures.js";

const origin = "http://127.0.0.1:3000";
const observedAt = "2026-10-04T12:00:00.000Z";
let catalog: Awaited<ReturnType<typeof database>>;
let api: ReturnType<typeof createPublicApi>;
let source: ReturnType<typeof artifact>;
let previous: Awaited<ReturnType<typeof seedOldScan>>["scan"];
let previousReportId: string;
let currentMatrixId: string;
let previousMatrixId: string;

function publicApi() {
  const registry = new RegistryClient({
    fetch: async (input) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      if (path === "/-/v1/search")
        return Response.json({
          objects: [{ package: { name: source.name, version: source.version } }],
        });
      if (path === `/${source.name}`)
        return Response.json({
          name: source.name,
          versions: { "1.0.0": {}, "2.0.0": {} },
          "dist-tags": { latest: "1.0.0" },
        });
      const version = path.split("/").at(-1);
      if (path === `/${source.name}/${version}` && ["1.0.0", "2.0.0"].includes(version ?? ""))
        return Response.json({
          ...source.manifest,
          version,
          dist: { integrity: source.integrity, tarball: source.tarballUrl },
        });
      return new Response("missing", { status: 404 });
    },
  });
  return createPublicApi(
    catalog.db,
    { origin, matrixId: currentMatrixId, requesterSecret: "a".repeat(64), scansEnabled: true },
    registry,
  );
}

async function insertReport(scanId: string, classifierRevision = CLASSIFIER_REVISION) {
  const [report] = await catalog.db
    .insert(schema.reports)
    .values({
      scanId,
      classifierRevision,
      payload: { observedAt, outcome: "inconclusive", coverageComplete: false },
    })
    .returning();
  if (!report) throw new Error("Fixture report missing.");
  return report.id;
}

async function insertCurrentScan(state: "requested" | "completed", observationRevision = 0) {
  const [scan] = await catalog.db
    .insert(schema.scans)
    .values({
      preparationId: previous.preparationId,
      matrixId: currentMatrixId,
      state,
      observationRevision,
      requesterKey: hash("public-discovery"),
      requesterExpiresAt: new Date(Date.now() + 86400_000),
      admissionPolicy: ADMISSION_POLICY.revision,
      requestedAt: new Date(Date.now() - 1200_000),
    })
    .returning();
  if (!scan) throw new Error("Fixture scan missing.");
  return scan.id;
}

async function lookup(version = source.version) {
  const response = await api(
    new Request(`${origin}/api/v1/packages?${new URLSearchParams({ name: source.name, version })}`),
  );
  expect(response.status).toBe(200);
  return packageResponseSchema.parse(await response.json());
}

async function counts() {
  return (
    await catalog.pool.query(
      "SELECT (SELECT count(*) FROM scans) AS scans,(SELECT count(*) FROM jobs) AS jobs",
    )
  ).rows;
}

beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => catalog?.dispose());
beforeEach(async () => {
  await catalog.pool.query("UPDATE service_controls SET worker_guard_enabled=false");
  await catalog.pool.query(
    "TRUNCATE probe_revisions,audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  const selection = await seedMatrix(catalog.db);
  previousMatrixId = selection.matrixId;
  currentMatrixId = await registerMatrix(
    catalog.db,
    matrix(selection.imageIds, "updated_v2"),
    actor,
  );
  source = artifact("@scope/discovery-fixture");
  previous = (await seedOldScan(catalog.db, previousMatrixId, source)).scan;
  await readyPreparation(catalog.db, previous.preparationId);
  await catalog.pool.query("UPDATE scans SET state='completed',finished_at=now() WHERE id=$1", [
    previous.scanId,
  ]);
  previousReportId = await insertReport(previous.scanId);
  api = publicApi();
});

it("exposes older-matrix evidence without treating it as a reusable current-matrix report", async () => {
  const before = await counts();
  await catalog.pool.query("UPDATE preparations SET snapshot_available=false");
  const pkg = await lookup();
  expect(pkg).toMatchObject({
    reportId: null,
    scanId: null,
    availableReport: {
      id: previousReportId,
      observedAt,
      classifierRevision: CLASSIFIER_REVISION,
      matchesCurrentMatrix: false,
      outcome: "inconclusive",
      coverageComplete: false,
      matrix: { id: previousMatrixId, revision: "initial_v1", platform: "linux_amd64_glibc" },
    },
  });
  const response = await api(new Request(`${origin}/api/v1/search?q=fixture`));
  const search = searchResponseSchema.parse(await response.json());
  expect(search.packages[0]).toMatchObject({
    reportId: null,
    availableReport: pkg.availableReport,
  });
  expect(await counts()).toEqual(before);
  const admittedResponse = await api(
    new Request(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: source.name, version: source.version }),
    }),
  );
  expect(admittedResponse.status).toBe(202);
  expect(await admittedResponse.json()).toMatchObject({ kind: "admitted" });
});

it("prefers the current matrix and keeps its report visible during a newer scan", async () => {
  const currentScanId = await insertCurrentScan("completed");
  const currentReportId = await insertReport(currentScanId);
  const activeScanId = await insertCurrentScan("requested", 1);
  expect(await lookup()).toMatchObject({
    reportId: currentReportId,
    scanId: activeScanId,
    availableReport: {
      id: currentReportId,
      matchesCurrentMatrix: true,
      matrix: { id: currentMatrixId },
    },
  });
});

it("retains older evidence while a scan in the current matrix is running", async () => {
  const activeScanId = await insertCurrentScan("requested");
  expect(await lookup()).toMatchObject({
    reportId: null,
    scanId: activeScanId,
    availableReport: { id: previousReportId, matchesCurrentMatrix: false },
  });
});

it("does not let a completed scan with no eligible report hide existing evidence", async () => {
  await insertCurrentScan("completed");
  expect(await lookup()).toMatchObject({
    reportId: null,
    availableReport: { id: previousReportId },
  });
});

it("requires the exact version and registry integrity for package evidence", async () => {
  expect(await lookup("2.0.0")).toMatchObject({ reportId: null, availableReport: null });
  source = { ...source, integrity: artifact("different-bytes").integrity };
  api = publicApi();
  expect(await lookup()).toMatchObject({ reportId: null, availableReport: null });
});

it.each([
  "invalidated",
  "replaced",
  "matrix_disabled",
  "quarantined",
  "blocked",
  "integrity_anomaly",
])("withdraws %s reports from package and search discovery", async (reason) => {
  if (reason === "invalidated") await invalidateReport(catalog.db, previousReportId, actor);
  if (reason === "replaced") {
    const replacement = await insertReport(previous.scanId, "classifier_future");
    await catalog.pool.query("UPDATE reports SET replaced_by=$1 WHERE id=$2", [
      replacement,
      previousReportId,
    ]);
  }
  if (reason === "matrix_disabled")
    await catalog.pool.query("UPDATE matrices SET enabled=false WHERE id=$1", [previousMatrixId]);
  if (reason === "quarantined")
    await catalog.pool.query("UPDATE runtime_images SET state='quarantined'");
  if (reason === "blocked")
    await catalog.db
      .insert(schema.blocks)
      .values({ scope: "package", subject: source.name, ...actor });
  if (reason === "integrity_anomaly")
    await catalog.pool.query("UPDATE package_versions SET integrity_anomaly=true");
  expect(await lookup()).toMatchObject({ reportId: null, availableReport: null });
  const response = await api(new Request(`${origin}/api/v1/search?q=fixture`));
  expect(searchResponseSchema.parse(await response.json()).packages[0]).toMatchObject({
    reportId: null,
    availableReport: null,
  });
});
