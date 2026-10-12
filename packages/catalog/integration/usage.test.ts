import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { applyRetention } from "../src/operations.js";
import { evidenceUsage, usageRecorder } from "../src/public/usage.js";
import { actor, database, migrateCatalog } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => catalog?.dispose());

it("deduplicates activity windows across replicas while retaining channel and research distinctions", async () => {
  const event = {
    surface: "report_page",
    availability: "available",
    source: "github",
    research: false,
  } as const;
  await Promise.all([usageRecorder(catalog.db)(event), usageRecorder(catalog.db)(event)]);
  await usageRecorder(catalog.db)({ ...event, research: true });
  await usageRecorder(catalog.db)({
    ...event,
    surface: "mcp_check_package",
    availability: "missing",
  });
  expect((await evidenceUsage(catalog.db)).activity).toHaveLength(3);
  expect(
    (await catalog.pool.query("SELECT sum(windows)::int AS total FROM evidence_usage")).rows[0]
      .total,
  ).toBe(3);
  await catalog.pool.query("UPDATE evidence_usage SET last_bucket=last_bucket-1");
  await usageRecorder(catalog.db)(event);
  expect(
    (await catalog.pool.query("SELECT sum(windows)::int AS total FROM evidence_usage")).rows[0]
      .total,
  ).toBe(4);
  const columns = (
    await catalog.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='evidence_usage' ORDER BY ordinal_position",
    )
  ).rows.map((row) => row.column_name);
  expect(columns).toEqual([
    "day",
    "surface",
    "availability",
    "source",
    "research",
    "windows",
    "last_bucket",
  ]);
  await catalog.pool.query("UPDATE evidence_usage SET day=day-30");
  await applyRetention(catalog.db, actor);
  expect((await evidenceUsage(catalog.db)).activity).toEqual([]);
});

it("leaves reads available when measurement storage fails", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  await catalog.pool.query("ALTER TABLE evidence_usage RENAME TO evidence_usage_unavailable");
  try {
    await expect(
      usageRecorder(catalog.db)({
        surface: "lookup_api",
        availability: "missing",
        source: "direct",
        research: false,
      }),
    ).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("usage_measurement_failed"));
  } finally {
    await catalog.pool.query("ALTER TABLE evidence_usage_unavailable RENAME TO evidence_usage");
    stderr.mockRestore();
  }
});
