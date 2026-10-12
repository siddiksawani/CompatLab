import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CatalogDatabase } from "../database.js";
import { reportControlError } from "../telemetry.js";

export const evidenceUsageSchema = z.strictObject({
  surface: z.enum([
    "report_page",
    "package_page",
    "lookup_api",
    "report_api",
    "mcp_check_package",
    "mcp_get_report",
  ]),
  availability: z.enum(["current", "earlier", "historical", "available", "missing", "error"]),
  source: z.enum([
    "direct",
    "internal",
    "search",
    "github",
    "medium",
    "dev",
    "reddit",
    "peerlist",
    "other",
  ]),
  research: z.boolean(),
});
export type EvidenceUsage = z.infer<typeof evidenceUsageSchema>;
export type UsageContext = Pick<EvidenceUsage, "source" | "research">;

export function usageContext(headers: Headers, origin: string): UsageContext {
  let source: EvidenceUsage["source"] = "direct";
  const raw = headers.get("referer");
  if (raw) {
    source = "other";
    try {
      const url = new URL(raw);
      if (["http:", "https:"].includes(url.protocol)) {
        const host = url.hostname.toLowerCase();
        if (url.origin === new URL(origin).origin) source = "internal";
        else if (/^(www\.)?(google\.(com|co\.in|co\.uk)|bing\.com|duckduckgo\.com)$/.test(host))
          source = "search";
        else {
          const sites = {
            "github.com": "github",
            "medium.com": "medium",
            "dev.to": "dev",
            "reddit.com": "reddit",
            "peerlist.io": "peerlist",
          } as const;
          for (const [domain, value] of Object.entries(sites))
            if (host === domain || host.endsWith(`.${domain}`)) source = value;
        }
      }
    } catch {}
  }
  return {
    source,
    research:
      headers.get("x-compatlab-research") === "1" ||
      (headers.get("user-agent") ?? "").startsWith("CompatLab-operator-audit/"),
  };
}

export function usageRecorder(db: CatalogDatabase) {
  const recent = new Map<string, number>();
  let busy = false;
  return async (raw: EvidenceUsage) => {
    const event = evidenceUsageSchema.parse(raw);
    const key = `${event.surface}:${event.availability}:${event.source}:${event.research}`;
    const bucket = Math.floor(Date.now() / 600_000);
    if (busy || recent.get(key) === bucket) return;
    busy = true;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='250ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
        await tx.execute(sql`
          INSERT INTO evidence_usage(day,surface,availability,source,research,last_bucket)
          VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date,${event.surface},${event.availability},${event.source},${event.research},floor(extract(epoch FROM clock_timestamp())/600)::bigint)
          ON CONFLICT(day,surface,availability,source,research) DO UPDATE
          SET windows=least(evidence_usage.windows+1,144),last_bucket=EXCLUDED.last_bucket
          WHERE evidence_usage.last_bucket<EXCLUDED.last_bucket`);
      });
      recent.set(key, bucket);
    } catch {
      reportControlError("usage_measurement_failed");
    } finally {
      busy = false;
    }
  };
}

export async function evidenceUsage(db: CatalogDatabase) {
  const rows = await db.execute(sql`
    SELECT day::text,surface,availability,source,research,windows
    FROM evidence_usage WHERE day>=(clock_timestamp() AT TIME ZONE 'UTC')::date-29
    ORDER BY day DESC,surface,availability,source,research`);
  return {
    schemaVersion: 1,
    retentionDays: 30,
    windowMinutes: 10,
    uniqueUsers: null,
    description:
      "Ten-minute activity windows, deduplicated across clients and replicas. Includes automation; not requests, people, conversions or proof of usefulness. Source is the immediate referrer group, not first-touch attribution. Research marking is voluntary.",
    activity: rows.rows,
  };
}
