import { randomUUID } from "node:crypto";
import { jobStateSchema, scanStateSchema } from "@compatlab/contracts";
import { planProbes, RUNTIME_PROFILES } from "@compatlab/engine";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  admitScan,
  blockSubject,
  catalogMigrations,
  findCachedReport,
  invalidateReport,
  migrateCatalog,
  openCatalog,
  quarantineRuntime,
  registerMatrix,
  registerRuntime,
  schema,
} from "../src/index.js";
import {
  actor,
  admitted,
  artifact,
  concurrent,
  database,
  hash,
  image,
  matrix,
  options,
  readyPreparation,
  seedMatrix,
  seedOldScan,
  seedReport,
} from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let selection: Awaited<ReturnType<typeof seedMatrix>>;
beforeAll(async () => {
  catalog = await database();
  await concurrent(Array.from({ length: 8 }, () => migrateCatalog(catalog.pool)));
});
afterAll(async () => {
  await catalog?.dispose();
});
beforeEach(async () => {
  await catalog.pool.query(
    "TRUNCATE audit_events, blocks, reports, jobs, runs, scans, matrix_members, matrices, runtime_images, preparations, workers, package_versions, packages CASCADE",
  );
  selection = await seedMatrix(catalog.db);
});

describe("concurrent admission", () => {
  it("deduplicates thirty concurrent requests into one preparation, scan and job", async () => {
    const source = artifact("@scope/test-package");
    const results = await concurrent(
      Array.from({ length: 30 }, () => admitScan(catalog.db, source, options(selection.matrixId))),
    );
    expect(results.filter((result) => result.kind === "admitted")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "existing")).toHaveLength(29);
    for (const table of ["preparations", "scans", "jobs"])
      expect(
        (await catalog.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
      ).toBe(1);
  });
  it("enforces the global twenty-scan queue across concurrent callers", async () => {
    const peers = [openCatalog(catalog.address), openCatalog(catalog.address)];
    let results: Awaited<ReturnType<typeof admitScan>>[];
    try {
      results = await concurrent(
        Array.from({ length: 30 }, (_, index) =>
          admitScan(
            peers[index % peers.length]?.db ?? catalog.db,
            artifact(),
            options(selection.matrixId),
          ),
        ),
      );
    } finally {
      await Promise.all(peers.map((peer) => peer.close()));
    }
    expect(results.filter((result) => result.kind === "admitted")).toHaveLength(20);
    expect(
      results.filter((result) => result.kind === "throttled" && result.reason === "queue_full"),
    ).toHaveLength(10);
    expect(await catalog.db.select().from(schema.jobs)).toHaveLength(20);
  });
  it("atomically caps a requester at two active scans and releases finished quota", async () => {
    const request = options(selection.matrixId, "one-requester");
    const results = await concurrent(
      Array.from({ length: 12 }, () => admitScan(catalog.db, artifact(), request)),
    );
    const accepted = results.filter((result) => result.kind === "admitted");
    expect(accepted).toHaveLength(2);
    expect(
      results.filter(
        (result) => result.kind === "throttled" && result.reason === "requester_limit",
      ),
    ).toHaveLength(10);
    await catalog.db
      .update(schema.scans)
      .set({ state: "cancelled" })
      .where(eq(schema.scans.id, admitted(accepted[0] as (typeof results)[number]).scanId));
    expect((await admitScan(catalog.db, artifact(), request)).kind).toBe("admitted");
  });
  it("serves cached reports and existing scans before quotas, including evicted snapshots", async () => {
    const cached = await seedReport(catalog.db, selection.matrixId);
    await catalog.db
      .update(schema.preparations)
      .set({ snapshotAvailable: false })
      .where(eq(schema.preparations.id, cached.scan.preparationId));
    const liveSource = artifact();
    const live = admitted(await admitScan(catalog.db, liveSource, options(selection.matrixId)));
    await concurrent(
      Array.from({ length: 19 }, () =>
        admitScan(catalog.db, artifact(), options(selection.matrixId)),
      ),
    );
    expect(await admitScan(catalog.db, cached.source, options(selection.matrixId))).toEqual({
      kind: "cached",
      reportId: cached.report.id,
      scanId: cached.scan.scanId,
    });
    expect(await admitScan(catalog.db, liveSource, options(selection.matrixId))).toEqual({
      kind: "existing",
      scanId: live.scanId,
      preparationId: live.preparationId,
    });
  });
  it("enforces the package/version cooldown across requesters and matrices", async () => {
    const source = artifact();
    const current = admitted(await admitScan(catalog.db, source, options(selection.matrixId)));
    await catalog.db
      .update(schema.scans)
      .set({ state: "cancelled" })
      .where(eq(schema.scans.id, current.scanId));
    const other = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds.slice(0, 2), "smaller_v1"),
      actor,
    );
    const result = await admitScan(catalog.db, source, options(other));
    expect(result).toMatchObject({ kind: "throttled", reason: "package_cooldown" });
    if (result.kind === "throttled") expect(result.retryAfterSeconds).toBeGreaterThan(290);
  });
  it("reuses a ready preparation for a new matrix without another preparation job", async () => {
    const { source, scan: first } = await seedOldScan(catalog.db, selection.matrixId);
    await readyPreparation(catalog.db, first.preparationId);
    await catalog.db
      .update(schema.scans)
      .set({ state: "completed" })
      .where(eq(schema.scans.id, first.scanId));
    const secondMatrix = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds.slice(0, 2), "smaller_v1"),
      actor,
    );
    const second = admitted(await admitScan(catalog.db, source, options(secondMatrix)));
    expect(second.preparationId).toBe(first.preparationId);
    expect(await catalog.db.select().from(schema.jobs)).toHaveLength(1);
  });
  it("creates a new generation for terminal work without a reusable report", async () => {
    const { source, scan: first } = await seedOldScan(catalog.db, selection.matrixId);
    const second = admitted(await admitScan(catalog.db, source, options(selection.matrixId)));
    expect(second.preparationId).not.toBe(first.preparationId);
  });
  it.each(["drained", "evicted", "orphaned"])(
    "does not reuse a %s preparation for another matrix",
    async (condition) => {
      const { source, scan } = await seedOldScan(catalog.db, selection.matrixId);
      if (condition !== "orphaned") await readyPreparation(catalog.db, scan.preparationId);
      if (condition === "drained")
        await catalog.db.update(schema.workers).set({ state: "drained" });
      if (condition === "evicted")
        await catalog.db.update(schema.preparations).set({ snapshotAvailable: false });
      const other = await registerMatrix(
        catalog.db,
        matrix(selection.imageIds.slice(0, 2), "other_v1"),
        actor,
      );
      const next = admitted(await admitScan(catalog.db, source, options(other)));
      expect(next.preparationId).not.toBe(scan.preparationId);
      expect(await catalog.db.select().from(schema.jobs)).toHaveLength(2);
    },
  );
  it("rolls back all admission records if job creation fails", async () => {
    await catalog.pool.query(
      "CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qualification rollback'; END $$; CREATE TRIGGER reject_test_job BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_test_job()",
    );
    try {
      await expect(
        admitScan(catalog.db, artifact(), options(selection.matrixId)),
      ).rejects.toThrow();
    } finally {
      await catalog.pool.query(
        "DROP TRIGGER reject_test_job ON jobs; DROP FUNCTION reject_test_job()",
      );
    }
    for (const table of ["packages", "package_versions", "preparations", "scans", "jobs"])
      expect(
        (await catalog.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
      ).toBe(0);
  });
});

describe("catalog policy and historical reports", () => {
  it.each(["package", "artifact", "image", "harness", "probe"] as const)(
    "rejects %s blocks in cached lookup and admission",
    async (scope) => {
      const fixture = await seedReport(catalog.db, selection.matrixId);
      const subjects = {
        package: fixture.source.name,
        artifact: fixture.preparation.artifactId,
        image: selection.imageIds[0] ?? "",
        harness: "load_v2",
        probe: "explicit_exports_v1",
      };
      const subject = subjects[scope];
      await blockSubject(
        catalog.db,
        scope,
        scope === "artifact" || scope === "image" ? subject.toUpperCase() : subject,
        actor,
      );
      await blockSubject(catalog.db, scope, subject, actor);
      expect((await catalog.db.select().from(schema.blocks))[0]?.subject).toBe(subject);
      expect(
        await findCachedReport(catalog.db, {
          artifactId: fixture.preparation.artifactId,
          matrixId: selection.matrixId,
          classifierRevision: "classifier_v1",
        }),
      ).toBeNull();
      expect(await admitScan(catalog.db, fixture.source, options(selection.matrixId))).toEqual({
        kind: "blocked",
        reason: "policy_or_matrix",
      });
      expect((await catalog.db.select().from(schema.reports))[0]?.payload).toEqual(
        fixture.report.payload,
      );
      expect(
        await catalog.db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.action, "subject_blocked")),
      ).toHaveLength(1);
    },
  );
  it("keeps invalidated reports immutable while excluding them from cache", async () => {
    const fixture = await seedReport(catalog.db, selection.matrixId);
    await invalidateReport(catalog.db, fixture.report.id, actor);
    await invalidateReport(catalog.db, fixture.report.id, actor);
    expect(
      await findCachedReport(catalog.db, {
        artifactId: fixture.preparation.artifactId,
        matrixId: selection.matrixId,
        classifierRevision: "classifier_v1",
      }),
    ).toBeNull();
    expect((await catalog.db.select().from(schema.reports))[0]?.payload).toEqual(
      fixture.report.payload,
    );
    expect(
      await catalog.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "report_invalidated")),
    ).toHaveLength(1);
    await expect(
      catalog.pool.query("UPDATE reports SET payload = '{}'::jsonb WHERE id = $1", [
        fixture.report.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query("UPDATE reports SET classifier_revision = 'changed' WHERE id = $1", [
        fixture.report.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects quarantined images and disabled matrices without deleting report history", async () => {
    const fixture = await seedReport(catalog.db, selection.matrixId);
    await quarantineRuntime(catalog.db, selection.imageIds[0] ?? "", actor);
    expect((await admitScan(catalog.db, fixture.source, options(selection.matrixId))).kind).toBe(
      "blocked",
    );
    expect(
      await findCachedReport(catalog.db, {
        artifactId: fixture.preparation.artifactId,
        matrixId: selection.matrixId,
        classifierRevision: "classifier_v1",
      }),
    ).toBeNull();
    const other = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds.slice(1), "other_v1"),
      actor,
    );
    await catalog.db
      .update(schema.matrices)
      .set({ enabled: false })
      .where(eq(schema.matrices.id, other));
    expect((await admitScan(catalog.db, artifact(), options(other))).kind).toBe("blocked");
    expect(await catalog.db.select().from(schema.reports)).toHaveLength(1);
  });
  it("flags changed integrity as a separate observation and rejects old cached evidence", async () => {
    const fixture = await seedReport(catalog.db, selection.matrixId);
    const changed = {
      ...fixture.source,
      integrity: `sha256-${Buffer.alloc(32, 9).toString("base64")}`,
    };
    expect(await admitScan(catalog.db, changed, options(selection.matrixId))).toEqual({
      kind: "blocked",
      reason: "artifact_integrity_changed",
    });
    expect(
      (await catalog.db.select().from(schema.packageVersions)).every((row) => row.integrityAnomaly),
    ).toBe(true);
    expect(await catalog.db.select().from(schema.packageVersions)).toHaveLength(2);
    expect((await admitScan(catalog.db, fixture.source, options(selection.matrixId))).kind).toBe(
      "blocked",
    );
    expect(
      await findCachedReport(catalog.db, {
        artifactId: fixture.preparation.artifactId,
        matrixId: selection.matrixId,
        classifierRevision: "classifier_v1",
      }),
    ).toBeNull();
    expect((await catalog.db.select().from(schema.reports))[0]?.payload).toEqual(
      fixture.report.payload,
    );
  });
  it("requires the requested classifier revision and excludes superseded reports", async () => {
    const fixture = await seedReport(catalog.db, selection.matrixId);
    const lookup = {
      artifactId: fixture.preparation.artifactId,
      matrixId: selection.matrixId,
      classifierRevision: "classifier_v2",
    };
    expect(await findCachedReport(catalog.db, lookup)).toBeNull();
    const [next] = await catalog.db
      .insert(schema.reports)
      .values({
        scanId: fixture.scan.scanId,
        classifierRevision: "classifier_v2",
        payload: { schemaVersion: 2 },
      })
      .returning();
    if (!next) throw new Error("Report fixture missing.");
    await catalog.db
      .update(schema.reports)
      .set({ replacedBy: next.id })
      .where(eq(schema.reports.id, fixture.report.id));
    expect(await findCachedReport(catalog.db, lookup)).toEqual({
      reportId: next.id,
      scanId: fixture.scan.scanId,
    });
    expect(
      await findCachedReport(catalog.db, { ...lookup, classifierRevision: "classifier_v1" }),
    ).toBeNull();
  });
});

describe("database constraints", () => {
  it("preserves conditional export order and rejects order-only manifest changes", async () => {
    const source = artifact();
    source.manifest.exports = { default: "./default.js", node: "./node.js" };
    await admitScan(catalog.db, source, options(selection.matrixId));
    const stored = (await catalog.db.select().from(schema.packageVersions))[0];
    if (!stored) throw new Error("Fixture artifact missing.");
    expect(Object.keys(stored.manifest.exports as object)).toEqual(["default", "node"]);
    const plan = planProbes(Buffer.from(JSON.stringify(stored.manifest)), RUNTIME_PROFILES);
    expect(plan.runtimes[0]?.root.esm).toEqual({
      applicable: true,
      reason: "public_target",
      target: "./default.js",
    });
    await expect(
      catalog.pool.query("UPDATE package_versions SET manifest=$1::json WHERE id=$2", [
        JSON.stringify({
          ...source.manifest,
          exports: { node: "./node.js", default: "./default.js" },
        }),
        stored.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("refreshes observed tags separately from immutable artifact metadata", async () => {
    const source = artifact();
    source.observedTags = { latest: "1.0.0", next: "2.0.0-beta.1" };
    await admitScan(catalog.db, source, options(selection.matrixId));
    const first = (await catalog.db.select().from(schema.packageVersions))[0];
    if (!first) throw new Error("Fixture artifact missing.");
    expect(first.observedTags).toEqual(source.observedTags);
    expect(first.tagsObservedAt).toBeInstanceOf(Date);
    const latest = { latest: "2.0.0" };
    expect(
      await admitScan(
        catalog.db,
        { ...source, observedTags: latest, manifest: { ...source.manifest, changed: true } },
        options(selection.matrixId),
      ),
    ).toMatchObject({ kind: "existing" });
    await admitScan(catalog.db, { ...source, observedTags: {} }, options(selection.matrixId));
    const rows = await catalog.db.select().from(schema.packageVersions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      observedAt: first.observedAt,
      manifest: source.manifest,
      observedTags: latest,
    });
    expect(rows[0]?.tagsObservedAt?.getTime()).toBeGreaterThanOrEqual(
      first.tagsObservedAt?.getTime() ?? 0,
    );
  });
  it("normalizes matrix image UUIDs before membership and uniqueness checks", async () => {
    expect(
      await registerMatrix(
        catalog.db,
        matrix(selection.imageIds.map((id) => id.toUpperCase())),
        actor,
      ),
    ).toBe(selection.matrixId);
    const imageId = selection.imageIds[0];
    if (!imageId) throw new Error("Fixture image missing.");
    await expect(
      registerMatrix(catalog.db, matrix([imageId, imageId.toUpperCase()], "duplicate_v1"), actor),
    ).rejects.toThrow("unique");
    const fixture = await seedReport(catalog.db, selection.matrixId);
    expect(
      await findCachedReport(catalog.db, {
        artifactId: fixture.preparation.artifactId.toUpperCase(),
        matrixId: selection.matrixId.toUpperCase(),
        classifierRevision: "classifier_v1",
      }),
    ).toEqual({ reportId: fixture.report.id, scanId: fixture.scan.scanId });
  });
  it("retains natural keys and immutable matrix/image definitions", async () => {
    await catalog.db.insert(schema.packages).values({ name: "immutable-package" });
    await expect(
      catalog.pool.query("UPDATE packages SET name='changed-package'"),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      await registerRuntime(catalog.db, { ...image(0), builtAt: new Date().toISOString() }, actor),
    ).toBe(selection.imageIds[0]);
    expect(await registerMatrix(catalog.db, matrix(selection.imageIds), actor)).toBe(
      selection.matrixId,
    );
    await expect(
      registerMatrix(catalog.db, matrix([...selection.imageIds].reverse()), actor),
    ).rejects.toThrow("immutable");
    await expect(
      catalog.pool.query("UPDATE matrices SET policy_revision = 'changed' WHERE id = $1", [
        selection.matrixId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query("DELETE FROM matrix_members WHERE matrix_id = $1", [selection.matrixId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query("UPDATE matrix_members SET position=5 WHERE matrix_id=$1 AND position=0", [
        selection.matrixId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query(
        "UPDATE runtime_images SET definition = jsonb_set(definition, '{version}', '\"99.0.0\"')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query(
        "INSERT INTO matrices(revision, platform, preparation_profile, harness_revision, plan_revision, policy_revision, runtime_count) SELECT 'incomplete', platform, preparation_profile, harness_revision, plan_revision, policy_revision, 1 FROM matrices LIMIT 1",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("ties each run to its scan's immutable matrix and prevents duplicate logical jobs", async () => {
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const otherMatrix = await registerMatrix(
      catalog.db,
      matrix(selection.imageIds.slice(0, 1), "single_v1"),
      actor,
    );
    const second = admitted(await admitScan(catalog.db, artifact(), options(otherMatrix)));
    await expect(
      catalog.pool.query(
        "INSERT INTO runs(scan_id,matrix_id,image_id,probe_group,mode) VALUES($1,$2,$3,'root','esm')",
        [scan.scanId, otherMatrix, selection.imageIds[0]],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      catalog.pool.query(
        "INSERT INTO runs(scan_id,matrix_id,image_id,probe_group,mode) VALUES($1,$2,$3,'root','esm')",
        [second.scanId, otherMatrix, selection.imageIds[1]],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      catalog.pool.query(
        "INSERT INTO jobs(kind,scan_id,preparation_id) VALUES('preparation',$1,$2)",
        [scan.scanId, scan.preparationId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(catalog.pool.query("UPDATE jobs SET state='leased'")).rejects.toMatchObject({
      code: "23514",
    });
    const run = (
      await catalog.db
        .insert(schema.runs)
        .values({
          scanId: scan.scanId,
          matrixId: selection.matrixId,
          imageId: selection.imageIds[0] ?? "",
          probeGroup: "root",
          mode: "esm",
          rawEvidence: { fixture: "original" },
        })
        .returning()
    )[0];
    if (!run) throw new Error("Fixture run missing.");
    await expect(
      catalog.pool.query("UPDATE runs SET raw_evidence='{}'::jsonb WHERE id=$1", [run.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("enforces preparation digests, ready identities and availability independently", async () => {
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    await expect(catalog.pool.query("UPDATE preparations SET state='ready'")).rejects.toMatchObject(
      { code: "23514" },
    );
    await expect(
      catalog.pool.query("UPDATE preparations SET lock_bytes='wrong',lock_digest=$1", [
        hash("different"),
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await readyPreparation(catalog.db, scan.preparationId);
    await expect(
      catalog.pool.query("UPDATE preparations SET snapshot_generation=gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query("UPDATE preparations SET lock_bytes='new',lock_digest=$1", [hash("new")]),
    ).rejects.toMatchObject({ code: "23514" });
    await catalog.db
      .update(schema.preparations)
      .set({ snapshotAvailable: false })
      .where(eq(schema.preparations.id, scan.preparationId));
    expect((await catalog.db.select().from(schema.preparations))[0]?.state).toBe("ready");
    await expect(
      catalog.pool.query(
        "INSERT INTO preparations(artifact_id,profile_revision,platform,resolution_generation) SELECT artifact_id,profile_revision,platform,resolution_generation FROM preparations LIMIT 1",
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("permits preparation worker retries before sealing and freezes locality afterwards", async () => {
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    const owners = await catalog.db
      .insert(schema.workers)
      .values(
        [0, 1].map((index) => ({
          tokenHash: hash(`worker-${index}`),
          capabilities: {},
          capacity: 1,
        })),
      )
      .returning();
    for (const owner of owners)
      await catalog.db
        .update(schema.preparations)
        .set({ ownerWorkerId: owner.id, state: "preparing" });
    await readyPreparation(catalog.db, scan.preparationId);
    await expect(
      catalog.pool.query("UPDATE preparations SET owner_worker_id=$1", [owners[0]?.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("bounds JSON and retained lock bytes in PostgreSQL", async () => {
    const fixture = await seedReport(catalog.db, selection.matrixId);
    await expect(
      catalog.pool.query(
        "INSERT INTO reports(scan_id,classifier_revision,payload) VALUES($1,'large',jsonb_build_object('data',repeat('x',20971520)))",
        [fixture.scan.scanId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query(
        "INSERT INTO package_versions(package_id,version,integrity,tarball_url,manifest) SELECT package_id,'2.0.0',integrity,tarball_url,jsonb_build_object('data',repeat('x',2097152)) FROM package_versions LIMIT 1",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query(
        "UPDATE package_versions SET observed_tags=jsonb_build_object('tag',repeat('x',65536)),tags_observed_at=now()",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      catalog.pool.query(
        "INSERT INTO preparations(artifact_id,profile_revision,platform,lock_bytes,lock_digest) SELECT artifact_id,profile_revision,platform,decode(repeat('00',16777217),'hex'),encode(sha256(decode(repeat('00',16777217),'hex')),'hex') FROM preparations LIMIT 1",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps Drizzle mappings and canonical lifecycle values aligned with the migration", async () => {
    for (const table of Object.values(schema)) {
      const columns = await catalog.pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [getTableName(table)],
      );
      expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
        Object.values(getTableColumns(table))
          .map((column) => column.name)
          .sort(),
      );
    }
    const scan = admitted(await admitScan(catalog.db, artifact(), options(selection.matrixId)));
    for (const state of scanStateSchema.options)
      await catalog.db.update(schema.scans).set({ state }).where(eq(schema.scans.id, scan.scanId));
    await readyPreparation(catalog.db, scan.preparationId);
    const preparation = (await catalog.db.select().from(schema.preparations))[0];
    if (!preparation?.ownerWorkerId) throw new Error("Fixture worker missing.");
    for (const state of jobStateSchema.options)
      await catalog.db.update(schema.jobs).set({
        state,
        attempt: 1,
        attemptToken: randomUUID(),
        sessionId: randomUUID(),
        workerId: preparation.ownerWorkerId,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        deadlineAt: new Date(Date.now() + 900_000),
      });
  });
  it("validates external identifiers before any database write", async () => {
    await expect(
      admitScan(catalog.db, { ...artifact(), name: "../bad" }, options(selection.matrixId)),
    ).rejects.toThrow();
    await expect(
      admitScan(catalog.db, artifact(), {
        ...options(selection.matrixId),
        requesterKey: "raw-address",
      }),
    ).rejects.toThrow();
    await expect(
      admitScan(catalog.db, { ...artifact(), version: "latest" }, options(selection.matrixId)),
    ).rejects.toThrow();
    for (const observedTags of [
      { latest: "not-a-version" },
      { "1.x": "1.0.0" },
      Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`tag-${index}`, "1.0.0"])),
    ])
      await expect(
        admitScan(catalog.db, { ...artifact(), observedTags }, options(selection.matrixId)),
      ).rejects.toThrow();
    expect(await catalog.db.select().from(schema.packages)).toHaveLength(0);
  });
});

it("upgrades legacy snapshots without replacing their reports or treating them as dispatchable", async () => {
  const upgrade = await database();
  try {
    const migrations = await catalogMigrations();
    await migrateCatalog(upgrade.pool, migrations.slice(0, 1));
    const selected = await seedMatrix(upgrade.db);
    const source = artifact("legacy-fixture");
    const pkg = (
      await upgrade.db.insert(schema.packages).values({ name: source.name }).returning()
    )[0];
    if (!pkg) throw new Error("Fixture package missing.");
    const version = (
      await upgrade.db
        .insert(schema.packageVersions)
        .values({
          packageId: pkg.id,
          version: source.version,
          integrity: source.integrity,
          tarballUrl: source.tarballUrl,
          manifest: source.manifest,
        })
        .returning()
    )[0];
    if (!version) throw new Error("Fixture artifact missing.");
    const owner = (
      await upgrade.pool.query(
        "INSERT INTO workers(token_hash,capabilities,capacity,state,last_seen_at) VALUES ($1,'{}',3,'healthy',now()) RETURNING id",
        [hash("legacy-worker")],
      )
    ).rows[0];
    const lock = Buffer.from('{"lockfileVersion":3}');
    const prep = (
      await upgrade.pool.query(
        "INSERT INTO preparations(artifact_id,profile_revision,platform,state,lock_bytes,lock_digest,snapshot_generation,tree_digest,owner_worker_id,snapshot_available) VALUES ($1,'npm_11_19_0_linux_amd64_v2','linux_amd64_glibc','ready',$2,$3,gen_random_uuid(),$4,$5,true) RETURNING id",
        [version.id, lock, hash(lock.toString()), hash("legacy-tree"), owner.id],
      )
    ).rows[0];
    const scan = (
      await upgrade.pool.query(
        "INSERT INTO scans(preparation_id,matrix_id,state,admission_policy,requested_at) VALUES ($1,$2,'completed','admission_v1',now()-interval '10 minutes') RETURNING id",
        [prep.id, selected.matrixId],
      )
    ).rows[0];
    const payload = { schemaVersion: 1, evidence: "retained legacy observation" };
    const report = (
      await upgrade.pool.query(
        "INSERT INTO reports(scan_id,classifier_revision,payload) VALUES ($1,'classifier_v1',$2) RETURNING id",
        [scan.id, payload],
      )
    ).rows[0];
    const pendingPreparation = (
      await upgrade.pool.query(
        "INSERT INTO preparations(artifact_id,profile_revision,platform,state,owner_worker_id) VALUES ($1,'npm_11_19_0_linux_amd64_v2','linux_amd64_glibc','preparing',$2) RETURNING id",
        [version.id, owner.id],
      )
    ).rows[0];
    const pendingScan = (
      await upgrade.pool.query(
        "INSERT INTO scans(preparation_id,matrix_id,state,admission_policy,requested_at,started_at,deadline_at) VALUES ($1,$2,'preparing','admission_v1',now()-interval '10 minutes',now(),now()+interval '15 minutes') RETURNING id",
        [pendingPreparation.id, selected.matrixId],
      )
    ).rows[0];
    const pendingJob = (
      await upgrade.pool.query(
        "INSERT INTO jobs(kind,scan_id,preparation_id,state,attempt,attempt_token,worker_id,lease_expires_at,deadline_at) VALUES ('preparation',$1,$2,'leased',1,gen_random_uuid(),$3,now()+interval '30 seconds',now()+interval '15 minutes') RETURNING id",
        [pendingScan.id, pendingPreparation.id, owner.id],
      )
    ).rows[0];
    await migrateCatalog(upgrade.pool);
    const recovered = (
      await upgrade.db.select().from(schema.jobs).where(eq(schema.jobs.id, pendingJob.id))
    )[0];
    expect(recovered).toMatchObject({ state: "leased", cleanupRequired: true });
    expect(recovered?.sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      await findCachedReport(upgrade.db, {
        artifactId: version.id,
        matrixId: selected.matrixId,
        classifierRevision: "classifier_v1",
      }),
    ).toEqual({ reportId: report.id, scanId: scan.id });
    expect((await upgrade.db.select().from(schema.reports))[0]?.payload).toEqual(payload);
    expect((await upgrade.db.select().from(schema.workers))[0]).toMatchObject({
      sessionId: null,
      recoveryRequired: true,
    });
    const other = await registerMatrix(
      upgrade.db,
      matrix(selected.imageIds.slice(0, 2), "upgrade_v1"),
      actor,
    );
    const fresh = admitted(await admitScan(upgrade.db, source, options(other)));
    expect(fresh.preparationId).not.toBe(prep.id);
    await expect(
      upgrade.pool.query("UPDATE preparations SET lock_bytes=$1,lock_digest=$2 WHERE id=$3", [
        Buffer.from("changed"),
        hash("changed"),
        prep.id,
      ]),
    ).rejects.toThrow("immutable preparation result");
  } finally {
    await upgrade.dispose();
  }
});

it("serializes migrations, verifies checksums, rolls back failures and preserves rows across additive upgrades", async () => {
  const upgrade = await database();
  try {
    const initial = await catalogMigrations();
    await concurrent(Array.from({ length: 10 }, () => migrateCatalog(upgrade.pool, initial)));
    await upgrade.db.insert(schema.packages).values({ name: "retained-package" });
    await expect(
      migrateCatalog(
        upgrade.pool,
        initial.map((item) => ({ ...item, sql: `${item.sql}\n-- changed` })),
      ),
    ).rejects.toThrow("history differs");
    const failed = {
      id: "9998_upgrade.sql",
      sql: "CREATE TABLE upgrade_probe(id integer); SELECT * FROM missing_upgrade_table",
    };
    await expect(migrateCatalog(upgrade.pool, [...initial, failed])).rejects.toThrow();
    expect(
      (await upgrade.pool.query("SELECT to_regclass('upgrade_probe') AS name")).rows[0].name,
    ).toBeNull();
    expect(
      (await upgrade.pool.query("SELECT count(*)::int AS count FROM schema_migrations")).rows[0]
        .count,
    ).toBe(initial.length);
    const additive = {
      id: "9998_upgrade.sql",
      sql: "ALTER TABLE packages ADD COLUMN description text",
    };
    await migrateCatalog(upgrade.pool, [...initial, additive]);
    expect((await upgrade.db.select().from(schema.packages))[0]?.name).toBe("retained-package");
    const selected = await seedMatrix(upgrade.db);
    expect((await admitScan(upgrade.db, artifact(), options(selected.matrixId))).kind).toBe(
      "admitted",
    );
    await expect(migrateCatalog(upgrade.pool, initial)).rejects.toThrow("history differs");
    await expect(migrateCatalog(upgrade.pool, [...initial, additive, additive])).rejects.toThrow(
      "unique ordered",
    );
  } finally {
    await upgrade.dispose();
  }
});
