import type { PackageResponse } from "@compatlab/contracts";
import { assertPackageName, isExactVersion } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import type { CatalogDatabase } from "../database.js";
import { reportControlError } from "../telemetry.js";

export function lookupRecorder(db: CatalogDatabase) {
  const recent = new Map<string, number>();
  let busy = false;
  return async (pkg: Pick<PackageResponse, "name" | "version" | "availableReport">) => {
    const availability = pkg.availableReport
      ? pkg.availableReport.matchesCurrentMatrix
        ? "current"
        : "earlier"
      : "missing";
    const key = `${pkg.name}@${pkg.version}:${availability}`;
    const bucket = Math.floor(Date.now() / 600_000);
    if (busy || recent.get(key) === bucket) return;
    assertPackageName(pkg.name);
    if (!isExactVersion(pkg.version)) throw new TypeError("Expected an exact version.");
    busy = true;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='250ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
        const lock = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(17228,3) AS acquired`,
        );
        if (!lock.rows[0]?.acquired) return;
        await tx.execute(sql`
          WITH clock AS (SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS day,
            floor(extract(epoch FROM clock_timestamp())/600)::bigint AS bucket)
          INSERT INTO lookup_demand(day,package_name,version,availability,last_bucket)
          SELECT day,${pkg.name},${pkg.version},${availability},bucket FROM clock
          WHERE EXISTS(SELECT 1 FROM lookup_demand WHERE day=clock.day AND package_name=${pkg.name}
            AND version=${pkg.version} AND availability=${availability})
            OR (SELECT count(*) FROM lookup_demand WHERE day=clock.day)<1000
          ON CONFLICT(day,package_name,version,availability) DO UPDATE
          SET windows=least(lookup_demand.windows+1,144),last_bucket=EXCLUDED.last_bucket
          WHERE lookup_demand.last_bucket<EXCLUDED.last_bucket`);
      });
      if (recent.size >= 256) recent.clear();
      recent.set(key, bucket);
    } catch {
      reportControlError("lookup_measurement_failed");
    } finally {
      busy = false;
    }
  };
}

export async function lookupDemand(db: CatalogDatabase) {
  const rows = await db.execute(sql`
    SELECT package_name AS name,version,availability,sum(windows)::int AS "lookupWindows",
      min(day)::text AS "firstDay",max(day)::text AS "lastDay"
    FROM lookup_demand WHERE day>=(clock_timestamp() AT TIME ZONE 'UTC')::date-29
    GROUP BY package_name,version,availability ORDER BY sum(windows) DESC,package_name,version,availability LIMIT 100`);
  return {
    schemaVersion: 1,
    retentionDays: 30,
    windowMinutes: 10,
    uniqueUsers: null,
    packages: rows.rows,
  };
}
