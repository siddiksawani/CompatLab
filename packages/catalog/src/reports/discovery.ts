import {
  CLASSIFIER_REVISION,
  compatibilityOutcomeSchema,
  hostedReportSchema,
  reportCellSchema,
} from "@compatlab/contracts";
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

const previewSchema = hostedReportSchema
  .pick({ id: true, observedAt: true, matrix: true, outcome: true, coverageComplete: true })
  .extend({
    artifact: hostedReportSchema.shape.artifact.pick({ name: true, version: true }),
    preparation: hostedReportSchema.shape.preparation.pick({ outcome: true }),
    cells: z
      .array(
        reportCellSchema.pick({
          profileId: true,
          group: true,
          mode: true,
          outcome: true,
          coverage: true,
        }),
      )
      .min(4)
      .max(64),
  });
export type ReportPreview = z.infer<typeof previewSchema>;

export async function discoverReportPreviews(db: CatalogReader, packageNames: string[]) {
  const names = z.array(z.string().min(1).max(214)).min(1).max(3).parse(packageNames);
  const wanted = sql.join(
    names.map((name, position) => sql`(${name}::text,${position}::int)`),
    sql`, `,
  );
  const result = await db.execute<{ preview: unknown }>(sql`
    SELECT jsonb_build_object(
      'id', chosen.id, 'artifact', jsonb_build_object('name', wanted.name, 'version', chosen.version),
      'observedAt', payload->'observedAt', 'matrix', payload->'matrix',
      'outcome', payload->'outcome', 'coverageComplete', payload->'coverageComplete',
      'preparation', jsonb_build_object('outcome', payload->'preparation'->'outcome'),
      'cells', (SELECT jsonb_agg(jsonb_build_object(
        'profileId', cell->'profileId', 'group', cell->'group', 'mode', cell->'mode',
        'outcome', cell->'outcome', 'coverage', cell->'coverage') ORDER BY position)
        FROM jsonb_array_elements(payload->'cells') WITH ORDINALITY AS entries(cell, position))
    ) AS preview
    FROM (VALUES ${wanted}) AS wanted(name, position)
    CROSS JOIN LATERAL (
      SELECT r.id, r.payload, v.version ${source}
      WHERE p.name=wanted.name AND ${eligible}
      ORDER BY r.created_at DESC,r.id LIMIT 1
    ) chosen
    ORDER BY wanted.position`);
  return result.rows.map((row) => previewSchema.parse(row.preview));
}

export async function reportIsDiscoverable(db: CatalogReader, id: string) {
  z.uuid().parse(id);
  const result = await db.execute(sql`SELECT r.id ${source} WHERE r.id=${id} AND ${eligible}`);
  return result.rows.length === 1;
}

export async function discoverRecentReports(db: CatalogReader) {
  const result = await db.execute<{
    id: string;
    name: string;
    version: string;
    outcome: unknown;
  }>(sql`SELECT r.id,p.name,v.version,r.payload->>'outcome' AS outcome ${source}
    WHERE ${eligible} ORDER BY r.created_at DESC,r.id LIMIT 6`);
  return result.rows.map((row) => ({
    ...row,
    outcome: compatibilityOutcomeSchema.parse(row.outcome),
  }));
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

export async function discoverPackageVersions(db: CatalogReader, prefix: string) {
  const digit = z
    .string()
    .regex(/^[a-f0-9]$/)
    .parse(prefix);
  const lower = `${digit}0000000-0000-0000-0000-000000000000`;
  const upper =
    digit === "f"
      ? null
      : `${(Number.parseInt(digit, 16) + 1).toString(16)}0000000-0000-0000-0000-000000000000`;
  const result = await db.execute<{ name: string; version: string }>(sql`
    SELECT DISTINCT p.name,v.version ${source}
    WHERE p.id>=${lower}::uuid ${upper ? sql`AND p.id<${upper}::uuid` : sql``}
      AND s.state IN ('completed','inconclusive') AND s.assertion_revision_id IS NULL
      AND r.classifier_revision=${CLASSIFIER_REVISION}
      AND r.invalidated_at IS NULL AND r.replaced_by IS NULL AND ${selectionAllowed}
    ORDER BY p.name,v.version LIMIT ${SITEMAP_LIMIT + 1}`);
  if (result.rows.length > SITEMAP_LIMIT)
    throw new Error("Package sitemap partition is full; increase its UUID prefix depth.");
  return result.rows;
}

export async function discoverCompatibility(
  db: CatalogReader,
  matrixId: string,
  options: {
    after?: string;
    failureRuntime?: "any" | "node" | "bun" | "deno";
    limit?: number;
  } = {},
) {
  z.uuid().parse(matrixId);
  const { after, failureRuntime, limit } = z
    .strictObject({
      after: z.uuid().optional(),
      failureRuntime: z.enum(["any", "node", "bun", "deno"]).optional(),
      limit: z.number().int().min(1).max(24).default(24),
    })
    .parse(options);
  const result = await db.execute<{
    artifactId: string;
    matchesCurrentMatrix: boolean;
    preview: unknown;
  }>(sql`
    SELECT v.id AS "artifactId",chosen."matchesCurrentMatrix",
      jsonb_build_object(
        'id',chosen.id,'artifact',jsonb_build_object('name',p.name,'version',v.version),
        'observedAt',payload->'observedAt','matrix',payload->'matrix',
        'outcome',payload->'outcome','coverageComplete',payload->'coverageComplete',
        'preparation',jsonb_build_object('outcome',payload->'preparation'->'outcome'),
        'cells',(SELECT jsonb_agg(jsonb_build_object(
          'profileId',cell->'profileId','group',cell->'group','mode',cell->'mode',
          'outcome',cell->'outcome','coverage',cell->'coverage') ORDER BY position)
          FROM jsonb_array_elements(payload->'cells') WITH ORDINALITY AS entries(cell,position))
      ) AS preview
    FROM package_versions v JOIN packages p ON p.id=v.package_id
    CROSS JOIN LATERAL (
      SELECT r.id,r.payload,m.id=${matrixId} AS "matchesCurrentMatrix"
      FROM preparations prep JOIN scans s ON s.preparation_id=prep.id
      JOIN matrices m ON m.id=s.matrix_id JOIN reports r ON r.scan_id=s.id
      WHERE prep.artifact_id=v.id AND ${selectionAllowed}
        AND s.state IN ('completed','inconclusive') AND s.assertion_revision_id IS NULL
        AND r.classifier_revision=${CLASSIFIER_REVISION}
        AND r.invalidated_at IS NULL AND r.replaced_by IS NULL
      ORDER BY (m.id=${matrixId}) DESC,s.requested_at DESC,s.id,r.created_at DESC,r.id LIMIT 1
    ) chosen
    WHERE ${after ? sql`v.id>${after}::uuid AND EXISTS (SELECT 1 FROM package_versions cursor WHERE cursor.id=${after}::uuid)` : sql`true`}
      ${
        failureRuntime
          ? sql`AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(payload->'matrix'->'images') image,
          jsonb_array_elements(payload->'cells') cell,
          jsonb_array_elements(cell->'entries') entry
        WHERE ${failureRuntime === "any" ? sql`true` : sql`image->>'kind'=${failureRuntime}`} AND cell->>'profileId'=image->>'profileId'
          AND entry->>'outcome'='fail' AND entry->'failure'->>'origin'='package'
      )`
          : sql``
      }
    ORDER BY v.id LIMIT ${limit + 1}`);
  const entries = result.rows.slice(0, limit).map((row) => ({
    artifactId: z.uuid().parse(row.artifactId),
    matchesCurrentMatrix: z.boolean().parse(row.matchesCurrentMatrix),
    report: previewSchema.parse(row.preview),
  }));
  return {
    entries,
    next: result.rows.length > limit ? (entries.at(-1)?.artifactId ?? null) : null,
  };
}
