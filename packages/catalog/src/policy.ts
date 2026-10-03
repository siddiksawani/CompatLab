import { sql } from "drizzle-orm";
import type { CatalogReader } from "./database.js";
import { lookupSchema, type ReportLookup } from "./validation.js";

// The outer query supplies p (package), v (artifact), and m (matrix).
const allowed = sql`
  NOT v.integrity_anomaly AND m.enabled
  AND NOT EXISTS (
    SELECT 1 FROM matrix_members mm JOIN runtime_images ri ON ri.id = mm.image_id
    WHERE mm.matrix_id = m.id AND ri.state <> 'approved'
  )
  AND NOT EXISTS (
    SELECT 1 FROM blocks b WHERE b.revoked_at IS NULL AND (
      (b.scope = 'package' AND b.subject = p.name) OR
      (b.scope = 'artifact' AND b.subject = v.id::text) OR
      (b.scope = 'harness' AND b.subject = m.harness_revision) OR
      (b.scope = 'probe' AND b.subject = m.plan_revision) OR
      (b.scope = 'image' AND b.subject IN (SELECT image_id::text FROM matrix_members WHERE matrix_id = m.id))
    )
  )`;

export async function allowedSelection(db: CatalogReader, artifactId: string, matrixId: string) {
  const result = await db.execute<{ profile: string; platform: string }>(sql`
    SELECT m.preparation_profile AS profile, m.platform FROM package_versions v
    JOIN packages p ON p.id = v.package_id CROSS JOIN matrices m
    WHERE v.id = ${artifactId} AND m.id = ${matrixId} AND ${allowed}`);
  return result.rows[0];
}

export async function findCachedReport(
  db: CatalogReader,
  rawLookup: ReportLookup,
): Promise<{ reportId: string; scanId: string } | null> {
  const lookup = lookupSchema.parse(rawLookup);
  const result = await db.execute<{ reportId: string; scanId: string }>(sql`
    SELECT r.id AS "reportId", s.id AS "scanId" FROM reports r
    JOIN scans s ON s.id = r.scan_id JOIN preparations prep ON prep.id = s.preparation_id
    JOIN package_versions v ON v.id = prep.artifact_id JOIN packages p ON p.id = v.package_id
    JOIN matrices m ON m.id = s.matrix_id
    WHERE v.id = ${lookup.artifactId} AND m.id = ${lookup.matrixId}
      AND r.classifier_revision = ${lookup.classifierRevision}
      AND s.state IN ('completed', 'inconclusive')
      AND r.invalidated_at IS NULL AND r.replaced_by IS NULL AND ${allowed}
    ORDER BY r.created_at DESC, r.id LIMIT 1`);
  return result.rows[0] ?? null;
}
