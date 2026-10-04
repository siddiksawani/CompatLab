import { assertPackageName, compareReports } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { assertionSelectionAllowed } from "../assertions/policy.js";
import type { CatalogDatabase } from "../database.js";
import { selectionAllowed } from "../policy.js";
import { PublicRequestError } from "../public/security.js";
import { readReport } from "./read.js";
export async function readComparison(db: CatalogDatabase, before: string, after: string) {
  z.uuid().parse(before);
  z.uuid().parse(after);
  const left = await readReport(db, before),
    right = await readReport(db, after);
  if (!left || !right) return null;
  if (left.report.artifact.name !== right.report.artifact.name)
    throw new PublicRequestError(400, "different_packages");
  return {
    schemaVersion: 1,
    comparison: compareReports(left.report, right.report),
    beforeStatus: left.status,
    afterStatus: right.status,
  };
}
export async function reportHistory(db: CatalogDatabase, name: string, before?: string) {
  let cursor: { at: string; id: string } | null;
  try {
    assertPackageName(name);
    if (before && before.length > 512) throw new TypeError("Cursor exceeds its bound.");
    cursor = before
      ? z
          .strictObject({ at: z.iso.datetime(), id: z.uuid() })
          .parse(JSON.parse(Buffer.from(before, "base64url").toString("utf8")))
      : null;
  } catch {
    throw new PublicRequestError(400, "invalid_identifier");
  }
  const rows = (
    await db.execute<{
      id: string;
      scanId: string;
      version: string;
      matrixRevision: string;
      observationRevision: number;
      previousScanId: string | null;
      createdAt: string;
      current: boolean;
    }>(
      sql`SELECT r.id,s.id AS "scanId",v.version,m.revision AS "matrixRevision",s.observation_revision AS "observationRevision",s.previous_scan_id AS "previousScanId",r.created_at AS "createdAt",(r.invalidated_at IS NULL AND r.replaced_by IS NULL AND (${selectionAllowed} AND ${assertionSelectionAllowed})) AS current FROM reports r JOIN scans s ON s.id=r.scan_id JOIN preparations prep ON prep.id=s.preparation_id JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id JOIN matrices m ON m.id=s.matrix_id WHERE p.name=${name} ${cursor ? sql`AND (r.created_at,r.id)<(${new Date(cursor.at)},${cursor.id}::uuid)` : sql``} ORDER BY r.created_at DESC,r.id DESC LIMIT 51`,
    )
  ).rows;
  const items = rows
      .slice(0, 50)
      .map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
    last = items.at(-1);
  return {
    schemaVersion: 1,
    name,
    reports: items,
    next:
      rows.length > 50 && last
        ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url")
        : null,
  };
}
export async function reportBadge(db: CatalogDatabase, id: string) {
  const result = await readReport(db, z.uuid().parse(id));
  if (!result) return null;
  const { report, status } = result;
  const left = report.evidenceLevel === "smoke_tested" ? "loading evidence" : "static evidence";
  const right = `${report.outcome.replaceAll("_", " ")} · ${(report.observedAt ?? report.classifiedAt).slice(0, 10)}${status.current ? "" : " · historical"}`;
  const width = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${left}: ${right}" width="${width}" height="28" viewBox="0 0 ${width} 28"><title>${left}: ${right}</title><rect width="${width}" height="28" rx="4" fill="#25344a"/><text x="12" y="19" fill="#ffffff" font-family="Verdana,sans-serif" font-size="12">${left}: ${right}</text></svg>`;
}
