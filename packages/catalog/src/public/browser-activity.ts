import { type BrowserActivity, browserActivitySchema } from "@compatlab/contracts";
import { sql } from "drizzle-orm";
import type { CatalogDatabase } from "../database.js";
import { reportControlError } from "../telemetry.js";
import {
  type PublicConfig,
  PublicRequestError,
  readAdmissionBody,
  requesterKey,
} from "./security.js";

export function browserActivityRecorder(db: CatalogDatabase) {
  return async (event: BrowserActivity) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout='250ms'`);
      await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
      const values = [...event.actions].sort().map(
        (action) => sql`(
        (clock_timestamp() AT TIME ZONE 'UTC')::date,
        ${action},${event.page},${event.source},${event.research},${event.automated},
        floor(extract(epoch FROM clock_timestamp())/600)::bigint
      )`,
      );
      await tx.execute(sql`
        INSERT INTO browser_activity(day,action,page,source,research,automated,last_bucket)
        VALUES ${sql.join(values, sql`,`)}
        ON CONFLICT(day,action,page,source,research,automated) DO UPDATE
        SET windows=least(browser_activity.windows+1,144),last_bucket=EXCLUDED.last_bucket
        WHERE browser_activity.last_bucket<EXCLUDED.last_bucket`);
    });
  };
}

export function createBrowserActivityApi(
  config: PublicConfig,
  record: (event: BrowserActivity) => Promise<void>,
) {
  let pending = 0,
    minute = -1,
    count = 0;
  const clients = new Map<string, number>();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply(405, { allow: "POST" });
    if (pending >= 2) return reply(429, { "retry-after": "60" });
    pending++;
    try {
      const current = Math.floor(Date.now() / 60_000);
      if (current !== minute) {
        clearTimeout(expiry);
        minute = current;
        count = 0;
        clients.clear();
        expiry = setTimeout(
          () => {
            clients.clear();
            count = 0;
            minute = -1;
          },
          60_000 - (Date.now() % 60_000),
        );
        expiry.unref();
      }
      if (++count > 120) return reply(429, { "retry-after": "60" });
      const key = requesterKey(request, config);
      const attempts = (clients.get(key) ?? 0) + 1;
      clients.set(key, attempts);
      if (attempts > 20) return reply(429, { "retry-after": "60" });
      const event = browserActivitySchema.parse(await readAdmissionBody(request, config.origin));
      if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1")
        return reply(204);
      const agent = request.headers.get("user-agent") ?? "";
      event.automated ||= /bot|crawler|spider|headless|playwright/i.test(agent);
      event.research ||=
        request.headers.get("x-compatlab-research") === "1" ||
        agent.startsWith("CompatLab-operator-audit/");
      try {
        await record(event);
      } catch {
        reportControlError("browser_measurement_failed");
      }
      return reply(204);
    } catch (error) {
      return reply(error instanceof PublicRequestError ? error.status : 400);
    } finally {
      pending--;
    }
  };
}
function reply(status: number, extra: Record<string, string> = {}) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, follow",
      ...extra,
    },
  });
}
export async function browserActivity(db: CatalogDatabase) {
  const rows = await db.execute(sql`
    SELECT day::text,action,page,source,research,automated,windows FROM browser_activity
    WHERE day>=(clock_timestamp() AT TIME ZONE 'UTC')::date-29
    ORDER BY day DESC,action,page,source,research,automated`);
  return {
    schemaVersion: 1,
    retentionDays: 30,
    windowMinutes: 10,
    uniqueUsers: null,
    description:
      "Browser action categories in shared ten-minute windows, not clicks, people or conversions. Source and research are self-reported. Automation detection is incomplete; automated=false does not establish a human. No identifiers or raw URLs are stored.",
    activity: rows.rows,
  };
}
