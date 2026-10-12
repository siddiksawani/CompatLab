import { availableReportSchema, CLASSIFIER_REVISION } from "@compatlab/contracts";
import { assertPackageName, isExactVersion } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CatalogReader } from "../database.js";
import { selectionAllowed } from "../policy.js";
import { selectPackageEvidence } from "../public/discovery.js";

export async function findPackageReport(
  db: CatalogReader,
  matrixId: string,
  name: string,
  version: string,
) {
  assertPackageName(name);
  if (!isExactVersion(version)) throw new TypeError("Expected an exact package version.");
  const [selection] = await selectPackageEvidence(db, matrixId, [{ name, version }]);
  return selection?.availableReport ?? null;
}

const otherReportSchema = availableReportSchema.extend({
  version: z.string().max(256),
  runtimePins: z
    .array(
      z.object({
        kind: z.enum(["node", "bun", "deno"]),
        version: z.string().max(128),
      }),
    )
    .max(16),
});

export async function findOtherPackageReports(
  db: CatalogReader,
  matrixId: string,
  name: string,
  selectedVersion: string,
) {
  assertPackageName(name);
  if (!isExactVersion(selectedVersion)) throw new TypeError("Expected an exact package version.");
  z.uuid().parse(matrixId);
  const result = await db.execute<{ report: unknown }>(sql`
    SELECT jsonb_build_object(
      'id',id,'version',version,'observedAt',payload->'observedAt',
      'classifierRevision',classifier_revision,'outcome',payload->'outcome',
      'coverageComplete',payload->'coverageComplete','matchesCurrentMatrix',matches_current,
      'matrix',jsonb_build_object('id',matrix_id,'revision',matrix_revision,'platform',platform),
      'runtimePins',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',image->'kind','version',image->'version'))
        FROM jsonb_array_elements(COALESCE(payload->'matrix'->'images','[]')) image),'[]')
    ) AS report FROM (
      SELECT DISTINCT ON (v.version) r.id,v.version,r.payload,r.classifier_revision,
        m.id AS matrix_id,m.revision AS matrix_revision,m.platform,m.id=${matrixId} AS matches_current
      FROM packages p JOIN package_versions v ON v.package_id=p.id
      JOIN preparations prep ON prep.artifact_id=v.id JOIN scans s ON s.preparation_id=prep.id
      JOIN matrices m ON m.id=s.matrix_id JOIN reports r ON r.scan_id=s.id
      WHERE p.name=${name} AND v.version<>${selectedVersion} AND ${selectionAllowed}
        AND s.state IN ('completed','inconclusive') AND s.assertion_revision_id IS NULL
        AND r.classifier_revision=${CLASSIFIER_REVISION}
        AND r.invalidated_at IS NULL AND r.replaced_by IS NULL
      ORDER BY v.version,(m.id=${matrixId}) DESC,s.requested_at DESC,s.id,r.created_at DESC,r.id
    ) chosen ORDER BY payload->>'observedAt' DESC NULLS LAST,version LIMIT 5`);
  return result.rows.map((row) => otherReportSchema.parse(row.report));
}
