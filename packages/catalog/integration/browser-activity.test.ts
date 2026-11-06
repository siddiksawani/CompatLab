import type { BrowserActivity } from "@compatlab/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyRetention } from "../src/operations.js";
import { browserActivity, browserActivityRecorder } from "../src/public/browser-activity.js";
import { actor, database, migrateCatalog } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => catalog?.dispose());
it("deduplicates browser categories across replicas and retains research/automation distinctions", async () => {
  const event: BrowserActivity = {
    actions: ["page_view", "evidence_opened"],
    page: "report",
    source: "search",
    research: false,
    automated: false,
  };
  await Promise.all([
    browserActivityRecorder(catalog.db)(event),
    browserActivityRecorder(catalog.db)(event),
  ]);
  await browserActivityRecorder(catalog.db)({ ...event, research: true, automated: true });
  const result = await browserActivity(catalog.db);
  expect(result.uniqueUsers).toBeNull();
  expect(result.activity).toHaveLength(4);
  expect(result.activity.every((row) => row.windows === 1)).toBe(true);
  await catalog.pool.query("UPDATE browser_activity SET last_bucket=last_bucket-1");
  await browserActivityRecorder(catalog.db)(event);
  expect(
    (await catalog.pool.query("SELECT sum(windows)::int AS total FROM browser_activity")).rows[0]
      .total,
  ).toBe(6);
  expect((await catalog.pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(0);
  const columns = (
    await catalog.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='browser_activity' ORDER BY ordinal_position",
    )
  ).rows.map((row) => row.column_name);
  expect(columns).toEqual([
    "day",
    "action",
    "page",
    "source",
    "research",
    "automated",
    "windows",
    "last_bucket",
  ]);
  await catalog.pool.query("UPDATE browser_activity SET day=day-30");
  await applyRetention(catalog.db, actor);
  expect((await browserActivity(catalog.db)).activity).toEqual([]);
});
