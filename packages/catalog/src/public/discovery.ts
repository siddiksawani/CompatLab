import {
  CLASSIFIER_REVISION,
  type PackageResponse,
  type SearchResponse,
} from "@compatlab/contracts";
import { assertPackageName, isExactVersion, RegistryClient, sanitizeText } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import type { CatalogDatabase } from "../database.js";
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
  async function selections(targets: { name: string; version: string; integrity?: string }[]) {
    if (!targets.length) return [];
    const result = await db.execute<{
      name: string;
      version: string;
      reportId: string | null;
      scanId: string | null;
    }>(sql`
      SELECT wanted.name,wanted.version,available.*
      FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS wanted(name text,version text,integrity text)
      LEFT JOIN LATERAL (
      SELECT CASE WHEN s.state IN ('requested','preparing','running','aggregating') THEN s.id ELSE NULL END AS "scanId", (SELECT r.id FROM reports r WHERE r.scan_id=s.id
        AND r.classifier_revision=${CLASSIFIER_REVISION} AND r.invalidated_at IS NULL AND r.replaced_by IS NULL
        ORDER BY r.created_at DESC,r.id LIMIT 1) AS "reportId"
      FROM scans s JOIN preparations prep ON prep.id=s.preparation_id
      JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id JOIN matrices m ON m.id=s.matrix_id
      WHERE p.name=wanted.name AND v.version=wanted.version AND m.id=${matrixId} AND ${selectionAllowed}
        AND (wanted.integrity IS NULL OR v.integrity=wanted.integrity)
        AND s.state IN ('requested','preparing','running','aggregating','completed','inconclusive')
      ORDER BY s.requested_at DESC,s.id LIMIT 1) available ON true`);
    return result.rows;
  }
  return {
    resolve,
    async search(query: string): Promise<SearchResponse> {
      const summaries = await cache.get(`search:${query}`, () => registry.search(query, 10));
      const availability = new Map(
        (await selections(summaries)).map((row) => [`${row.name}@${row.version}`, row.reportId]),
      );
      return {
        schemaVersion: 1,
        packages: summaries.map((summary) => ({
          ...summary,
          ...(summary.description ? { description: sanitizeText(summary.description, false) } : {}),
          reportId: availability.get(`${summary.name}@${summary.version}`) ?? null,
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
      const [available] = await selections([
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
        scanId: available?.scanId ?? null,
        scansEnabled,
      };
    },
  };
}
