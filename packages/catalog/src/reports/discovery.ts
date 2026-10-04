import { sql } from "drizzle-orm";
import { z } from "zod";
import { assertionSelectionAllowed } from "../assertions/policy.js";
import type { CatalogReader } from "../database.js";
import { selectionAllowed } from "../policy.js";

export const SITEMAP_PREFIXES = "0123456789abcdef".split("");
export const SITEMAP_LIMIT = 50_000;
const source = sql`FROM reports r JOIN scans s ON s.id=r.scan_id
  JOIN preparations prep ON prep.id=s.preparation_id JOIN package_versions v ON v.id=prep.artifact_id
  JOIN packages p ON p.id=v.package_id JOIN matrices m ON m.id=s.matrix_id`;
const eligible = sql`s.state='completed' AND r.invalidated_at IS NULL AND r.replaced_by IS NULL
  AND ${selectionAllowed} AND ${assertionSelectionAllowed}`;

export async function reportIsDiscoverable(db: CatalogReader, id: string) {
  z.uuid().parse(id);
  const result = await db.execute(sql`SELECT r.id ${source} WHERE r.id=${id} AND ${eligible}`);
  return result.rows.length === 1;
}

export async function discoverReports(db: CatalogReader, prefix?: string) {
  const digit =
    prefix === undefined
      ? undefined
      : z
          .string()
          .regex(/^[a-f0-9]$/)
          .parse(prefix);
  const lower = digit === undefined ? null : `${digit}0000000-0000-0000-0000-000000000000`;
  const upper =
    digit === undefined || digit === "f"
      ? null
      : `${(Number.parseInt(digit, 16) + 1).toString(16)}0000000-0000-0000-0000-000000000000`;
  const range = lower
    ? sql`AND r.id>=${lower}::uuid ${upper ? sql`AND r.id<${upper}::uuid` : sql``}`
    : sql``;
  const result = await db.execute<{
    id: string;
    name: string;
    version: string;
    updatedAt: string;
  }>(sql`
    SELECT r.id,p.name,v.version,r.created_at AS "updatedAt" ${source}
    WHERE ${eligible} ${range}
    ORDER BY ${digit === undefined ? sql`r.created_at DESC,r.id` : sql`r.id`}
    LIMIT ${digit === undefined ? 6 : SITEMAP_LIMIT + 1}`);
  if (result.rows.length > SITEMAP_LIMIT)
    throw new Error("Report sitemap partition is full; increase its UUID prefix depth.");
  return result.rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() }));
}
