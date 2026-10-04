import { afterAll, beforeAll, expect, it } from "vitest";
import {
  discoverReports,
  invalidateReport,
  migrateCatalog,
  quarantineRuntime,
  reportIsDiscoverable,
  SITEMAP_PREFIXES,
} from "../src/index.js";
import { actor, database, seedMatrix, seedReport } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => {
  await catalog?.dispose();
});

it("partitions completed eligible reports without creating work and removes invalidated evidence", async () => {
  const matrix = await seedMatrix(catalog.db);
  const valid = await seedReport(catalog.db, matrix.matrixId);
  const invalid = await seedReport(catalog.db, matrix.matrixId);
  const unfinished = await seedReport(catalog.db, matrix.matrixId);
  await invalidateReport(catalog.db, invalid.report.id, actor);
  await catalog.pool.query("UPDATE scans SET state='inconclusive' WHERE id=$1", [
    unfinished.scan.scanId,
  ]);
  const jobs = (await catalog.pool.query("SELECT count(*) FROM jobs")).rows;
  const partitions = (
    await Promise.all(SITEMAP_PREFIXES.map((prefix) => discoverReports(catalog.db, prefix)))
  ).flat();
  expect(partitions.map((report) => report.id)).toEqual([valid.report.id]);
  expect(await reportIsDiscoverable(catalog.db, valid.report.id)).toBe(true);
  expect(await reportIsDiscoverable(catalog.db, invalid.report.id)).toBe(false);
  expect(await reportIsDiscoverable(catalog.db, unfinished.report.id)).toBe(false);
  expect((await discoverReports(catalog.db))[0]).toMatchObject({
    name: valid.source.name,
    version: valid.source.version,
  });
  expect((await catalog.pool.query("SELECT count(*) FROM jobs")).rows).toEqual(jobs);
  const imageId = (await catalog.pool.query("SELECT id FROM runtime_images LIMIT 1")).rows[0]
    .id as string;
  await quarantineRuntime(catalog.db, imageId, actor);
  expect(await discoverReports(catalog.db)).toEqual([]);
  expect(await reportIsDiscoverable(catalog.db, valid.report.id)).toBe(false);
  await expect(discoverReports(catalog.db, "f OR true")).rejects.toThrow();
});
