import {
  availableReportSchema,
  CLASSIFIER_REVISION,
  type PackageResponse,
  type SearchResponse,
} from "@compatlab/contracts";
import { assertPackageName, isExactVersion, RegistryClient, sanitizeText } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import type { CatalogDatabase, CatalogReader } from "../database.js";
import { selectionAllowed } from "../policy.js";
import { MetadataCache } from "./cache.js";

export function publicDiscovery(
  db: CatalogDatabase,
  matrixId: string,
  scansEnabled: boolean,
  registry = new RegistryClient(),
) {
  const cache = new MetadataCache();
  const resolve = (name: string, version: string) =>
    cache.get(`artifact:${name}@${version}`, () => registry.resolve(name, version));
  return {
    resolve,
    async search(query: string): Promise<SearchResponse> {
      const summaries = await cache.get(`search:${query}`, () => registry.search(query, 10));
      const availability = new Map(
        (await selectPackageEvidence(db, matrixId, summaries)).map((row) => [
          `${row.name}@${row.version}`,
          row,
        ]),
      );
      return {
        schemaVersion: 1,
        packages: summaries.map((summary) => ({
          ...summary,
          ...(summary.description ? { description: sanitizeText(summary.description, false) } : {}),
          reportId: availability.get(`${summary.name}@${summary.version}`)?.reportId ?? null,
          availableReport:
            availability.get(`${summary.name}@${summary.version}`)?.availableReport ?? null,
        })),
      };
    },
    async package(name: string, version?: string): Promise<PackageResponse> {
      assertPackageName(name);
      if (version !== undefined && !isExactVersion(version))
        throw new TypeError("Select an exact published version.");
      const published = await cache.get(`versions:${name}`, async () => {
        const result = await registry.versions(name);
        return {
          versions: result.versions.slice(0, 200),
          versionsTruncated: result.versions.length > 200,
          tags: Object.fromEntries(Object.entries(result.tags).slice(0, 100)),
        };
      });
      const artifact = await resolve(
        name,
        version ?? published.tags.latest ?? published.versions[0] ?? "latest",
      );
      const repository = artifact.manifest.repository;
      const rawUrl =
        typeof repository === "string"
          ? repository
          : repository && typeof repository === "object" && "url" in repository
            ? repository.url
            : null;
      const url = typeof rawUrl === "string" ? URL.parse(rawUrl.replace(/^git\+/, "")) : null;
      const [available] = await selectPackageEvidence(db, matrixId, [
        { name, version: artifact.version, integrity: artifact.integrity },
      ]);
      return {
        schemaVersion: 1,
        name,
        version: artifact.version,
        description: sanitizeText(
          typeof artifact.manifest.description === "string"
            ? artifact.manifest.description.slice(0, 4096)
            : "No description supplied by the registry.",
          false,
        ),
        deprecated:
          typeof artifact.manifest.deprecated === "string"
            ? sanitizeText(artifact.manifest.deprecated.slice(0, 4096), false)
            : null,
        repositoryUrl:
          url && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
            ? url.href
            : null,
        ...published,
        reportId: available?.reportId ?? null,
        availableReport: available?.availableReport ?? null,
        scanId: available?.scanId ?? null,
        scansEnabled,
      };
    },
  };
}

export async function selectPackageEvidence(
  db: CatalogReader,
  matrixId: string,
  targets: { name: string; version: string; integrity?: string }[],
) {
  if (!targets.length) return [];
  const source = sql`FROM scans s JOIN preparations prep ON prep.id=s.preparation_id
    JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id
    JOIN matrices m ON m.id=s.matrix_id`;
  const eligible = sql`p.name=wanted.name AND v.version=wanted.version AND ${selectionAllowed}
    AND s.assertion_revision_id IS NULL
    AND (wanted.integrity IS NULL OR v.integrity=wanted.integrity)`;
  const result = await db.execute<{
    name: string;
    version: string;
    scanId: string | null;
    availableReport: unknown;
  }>(sql`
    SELECT wanted.name,wanted.version,active."scanId",available."availableReport"
    FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS wanted(name text,version text,integrity text)
    LEFT JOIN LATERAL (
      SELECT s.id AS "scanId" ${source}
      WHERE ${eligible} AND m.id=${matrixId}
        AND s.state IN ('requested','preparing','running','aggregating')
      ORDER BY s.requested_at DESC,s.id LIMIT 1
    ) active ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id',r.id,'observedAt',r.payload->'observedAt',
        'classifierRevision',r.classifier_revision,'outcome',r.payload->'outcome',
        'coverageComplete',r.payload->'coverageComplete','matchesCurrentMatrix',m.id=${matrixId},
        'matrix',jsonb_build_object('id',m.id,'revision',m.revision,'platform',m.platform)
      ) AS "availableReport"
      ${source} JOIN reports r ON r.scan_id=s.id
      WHERE ${eligible} AND s.state IN ('completed','inconclusive')
        AND r.classifier_revision=${CLASSIFIER_REVISION}
        AND r.invalidated_at IS NULL AND r.replaced_by IS NULL
      ORDER BY (m.id=${matrixId}) DESC,s.requested_at DESC,s.id,r.created_at DESC,r.id LIMIT 1
    ) available ON true`);
  return result.rows.map((row) => {
    const availableReport = availableReportSchema.nullable().parse(row.availableReport);
    return {
      ...row,
      availableReport,
      reportId: availableReport?.matchesCurrentMatrix ? availableReport.id : null,
    };
  });
}
