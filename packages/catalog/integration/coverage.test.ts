import { RegistryClient } from "@compatlab/engine";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  addCoverageTargets,
  admitScan,
  advanceCoverage,
  applyRetention,
  blockSubject,
  coverageStatus,
  lookupDemand,
  migrateCatalog,
  setAdmissionPaused,
  setCoveragePaused,
  setWorkerGuard,
  skipCoverageTarget,
} from "../src/index.js";
import { lookupRecorder } from "../src/public/measurement.js";
import { actor, artifact, database, options, seedMatrix } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let matrixId: string;
let registry: RegistryClient;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => catalog?.dispose());
beforeEach(async () => {
  await catalog.pool.query(
    "TRUNCATE lookup_demand,coverage_targets,audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  await catalog.pool.query(
    "UPDATE service_controls SET coverage_paused=true,admission_paused=false,worker_guard_enabled=false,deployment_release=NULL",
  );
  matrixId = (await seedMatrix(catalog.db)).matrixId;
  registry = new RegistryClient({
    fetch: async (input) => {
      const name = decodeURIComponent(new URL(String(input)).pathname)
        .split("/")
        .slice(1, -1)
        .join("/");
      const source = artifact(name);
      return Response.json({
        ...source.manifest,
        dist: { integrity: source.integrity, tarball: source.tarballUrl },
      });
    },
  });
});
const targets = [
  { name: "@scope/fixture", version: "1.0.0" },
  { name: "second-fixture", version: "1.0.0" },
];
async function countScans() {
  return (await catalog.pool.query("SELECT count(*)::int AS count FROM scans")).rows[0].count;
}
async function due() {
  await catalog.pool.query("UPDATE coverage_targets SET next_attempt_at=now()-interval '1 second'");
}

it("keeps imports paused and deduplicates targets without executing them", async () => {
  expect(await addCoverageTargets(catalog.db, matrixId, targets, actor)).toEqual({ added: 2 });
  expect(await addCoverageTargets(catalog.db, matrixId, targets, actor)).toEqual({ added: 0 });
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(0);
  expect(await coverageStatus(catalog.db)).toMatchObject({
    paused: true,
    totals: [{ state: "pending", count: 2 }],
  });
  await expect(
    addCoverageTargets(catalog.db, matrixId, [{ name: "express", version: "latest" }], actor),
  ).rejects.toThrow();
  await expect(
    addCoverageTargets(
      catalog.db,
      matrixId,
      Array.from({ length: 51 }, () => targets[0]),
      actor,
    ),
  ).rejects.toThrow();
});

it("enforces the durable queue cap without breaking idempotent imports and can retire pending work", async () => {
  for (let batch = 0; batch < 4; batch++) {
    await addCoverageTargets(
      catalog.db,
      matrixId,
      Array.from({ length: 50 }, (_, i) => ({ name: `fixture-${batch}-${i}`, version: "1.0.0" })),
      actor,
    );
  }
  expect(
    await addCoverageTargets(
      catalog.db,
      matrixId,
      [{ name: "fixture-0-0", version: "1.0.0" }],
      actor,
    ),
  ).toEqual({ added: 0 });
  await expect(addCoverageTargets(catalog.db, matrixId, targets, actor)).rejects.toThrow(
    "limited to 200",
  );
  const pending = (await catalog.pool.query("SELECT id FROM coverage_targets ORDER BY id LIMIT 1"))
    .rows[0].id;
  await skipCoverageTarget(catalog.db, pending, actor);
  await expect(skipCoverageTarget(catalog.db, pending, actor)).rejects.toThrow("Only pending");
  expect(await addCoverageTargets(catalog.db, matrixId, [targets[0]], actor)).toEqual({ added: 1 });
  expect(
    (
      await catalog.pool.query(
        "SELECT count(*)::int AS count FROM coverage_targets WHERE state='pending'",
      )
    ).rows[0].count,
  ).toBe(200);
});

it("submits at most one scan across concurrent ticks and tracks terminal states after restart", async () => {
  await addCoverageTargets(catalog.db, matrixId, targets, actor);
  await setCoveragePaused(catalog.db, false, actor);
  await Promise.all(Array.from({ length: 5 }, () => advanceCoverage(catalog.db, registry)));
  expect(await countScans()).toBe(1);
  expect((await catalog.pool.query("SELECT source FROM scans")).rows[0].source).toBe("coverage");
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(1);
  await catalog.pool.query("UPDATE scans SET state='inconclusive',finished_at=now()");
  await catalog.pool.query("UPDATE jobs SET state='finished'");
  await due();
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(2);
  expect(await coverageStatus(catalog.db)).toMatchObject({
    totals: [
      { state: "completed", count: 1 },
      { state: "submitted", count: 1 },
    ],
  });
});

it.each(["pause", "deployment", "outage", "foreground"])(
  "does not resolve or admit new coverage during %s",
  async (gate) => {
    await addCoverageTargets(catalog.db, matrixId, targets, actor);
    await setCoveragePaused(catalog.db, false, actor);
    if (gate === "pause") await setAdmissionPaused(catalog.db, true, actor);
    if (gate === "deployment")
      await catalog.pool.query("UPDATE service_controls SET deployment_release=$1", [
        "a".repeat(40),
      ]);
    if (gate === "outage") await setWorkerGuard(catalog.db, true, actor);
    if (gate === "foreground") await admitScan(catalog.db, artifact(), options(matrixId));
    const before = await countScans();
    const resolve = vi.spyOn(registry, "resolve");
    await advanceCoverage(catalog.db, registry);
    expect(resolve).not.toHaveBeenCalled();
    expect(await countScans()).toBe(before);
  },
);

it("rechecks foreground capacity after registry I/O and preserves package blocks", async () => {
  await addCoverageTargets(catalog.db, matrixId, [targets[0]], actor);
  await setCoveragePaused(catalog.db, false, actor);
  vi.spyOn(registry, "resolve").mockImplementationOnce(async (name) => {
    await admitScan(catalog.db, artifact("foreground"), options(matrixId));
    return artifact(name);
  });
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(1);
  expect((await catalog.pool.query("SELECT source FROM scans")).rows[0].source).toBe("public");
  await catalog.pool.query("UPDATE scans SET state='cancelled'");
  await catalog.pool.query("UPDATE jobs SET state='finished'");
  await blockSubject(catalog.db, "package", "@scope/fixture", actor);
  await due();
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(1);
  expect(await coverageStatus(catalog.db)).toMatchObject({
    totals: [{ state: "blocked", count: 1 }],
  });
});

it("bounds registry retries and records failures without creating scans", async () => {
  await addCoverageTargets(catalog.db, matrixId, [targets[0]], actor);
  await setCoveragePaused(catalog.db, false, actor);
  const resolve = vi
    .spyOn(registry, "resolve")
    .mockRejectedValue(new Error("private registry details"));
  for (let attempt = 0; attempt < 5; attempt++) {
    await due();
    await advanceCoverage(catalog.db, registry);
  }
  expect(resolve).toHaveBeenCalledTimes(3);
  expect(await countScans()).toBe(0);
  expect(await coverageStatus(catalog.db)).toMatchObject({
    targets: [{ state: "failed", attempts: 3, reason: "registry_metadata_unavailable" }],
  });
});

it("uses the shared admission hourly quota for curated work", async () => {
  await addCoverageTargets(catalog.db, matrixId, [targets[0]], actor);
  await setCoveragePaused(catalog.db, false, actor);
  await advanceCoverage(catalog.db, registry);
  const requesterKey = (await catalog.pool.query("SELECT requester_key FROM scans")).rows[0]
    .requester_key;
  await catalog.pool.query("UPDATE scans SET state='cancelled'");
  await catalog.pool.query("UPDATE jobs SET state='finished'");
  for (let i = 0; i < 9; i++) {
    expect(
      await admitScan(catalog.db, artifact(`quota-${i}`), { ...options(matrixId), requesterKey }),
    ).toMatchObject({ kind: "admitted" });
    await catalog.pool.query("UPDATE scans SET state='cancelled'");
    await catalog.pool.query("UPDATE jobs SET state='finished'");
  }
  await addCoverageTargets(catalog.db, matrixId, [targets[1]], actor);
  await advanceCoverage(catalog.db, registry);
  expect(await countScans()).toBe(10);
  expect(
    (await catalog.pool.query("SELECT last_reason FROM coverage_targets WHERE state='pending'"))
      .rows[0].last_reason,
  ).toBe("requester_rate");
});

it("deduplicates lookup windows across processes and retains no requester data", async () => {
  const pkg = { name: "express", version: "5.2.1", availableReport: null };
  const record = lookupRecorder(catalog.db);
  await record(pkg);
  await Promise.all(Array.from({ length: 10 }, () => lookupRecorder(catalog.db)(pkg)));
  await record(pkg);
  expect(await lookupDemand(catalog.db)).toMatchObject({
    uniqueUsers: null,
    packages: [{ name: "express", version: "5.2.1", availability: "missing", lookupWindows: 1 }],
  });
  expect(await countScans()).toBe(0);
  await catalog.pool.query("UPDATE lookup_demand SET last_bucket=last_bucket-1");
  await lookupRecorder(catalog.db)(pkg);
  expect(await lookupDemand(catalog.db)).toMatchObject({ packages: [{ lookupWindows: 2 }] });
  const columns = (
    await catalog.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='lookup_demand' ORDER BY ordinal_position",
    )
  ).rows.map((row) => row.column_name);
  expect(columns).toEqual([
    "day",
    "package_name",
    "version",
    "availability",
    "windows",
    "last_bucket",
  ]);
});

it("caps daily cardinality, expires old aggregates and fails open on measurement errors", async () => {
  await catalog.pool.query(
    "INSERT INTO lookup_demand(day,package_name,version,availability,last_bucket) SELECT (now() AT TIME ZONE 'UTC')::date,'fixture-'||i,'1.0.0','missing',0 FROM generate_series(1,1000) i",
  );
  const pkg = { name: "extra-package", version: "1.0.0", availableReport: null };
  await lookupRecorder(catalog.db)(pkg);
  expect(
    (await catalog.pool.query("SELECT count(*)::int AS count FROM lookup_demand")).rows[0].count,
  ).toBe(1000);
  await catalog.pool.query("UPDATE lookup_demand SET day=day-30");
  await applyRetention(catalog.db, actor);
  expect((await lookupDemand(catalog.db)).packages).toEqual([]);
  expect(
    (await catalog.pool.query("SELECT count(*)::int AS count FROM lookup_demand")).rows[0].count,
  ).toBe(0);
  await catalog.pool.query("ALTER TABLE lookup_demand RENAME TO lookup_demand_unavailable");
  try {
    await expect(lookupRecorder(catalog.db)(pkg)).resolves.toBeUndefined();
  } finally {
    await catalog.pool.query("ALTER TABLE lookup_demand_unavailable RENAME TO lookup_demand");
  }
});
