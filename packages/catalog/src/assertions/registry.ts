import {
  assertionDefinition,
  matchingVersions,
  type RegistryClient,
  validateAssertionBundle,
} from "@compatlab/engine";
import { and, eq, sql } from "drizzle-orm";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import {
  assertLinkedAuthority,
  assertRepository,
  type LinkedAuthority,
} from "../monitoring/authority.js";
import { PublicRequestError } from "../public/security.js";
import { probeRevisions } from "./schema.js";
export async function registerAssertion(
  db: CatalogDatabase,
  authority: LinkedAuthority,
  raw: unknown,
  registry: RegistryClient,
) {
  const bundle = validateAssertionBundle(raw),
    definition = assertionDefinition(bundle);
  if (bundle.repository.toLowerCase() !== authority.proof.fullName.toLowerCase())
    throw new PublicRequestError(403, "package_repository_mismatch");
  const versions = matchingVersions(
    (await registry.versions(bundle.manifest.packageName)).versions,
    bundle.manifest.packageRange,
  );
  const latest = versions.at(-1);
  if (!latest) throw new PublicRequestError(400, "no_matching_versions");
  assertRepository(
    (await registry.resolve(bundle.manifest.packageName, latest)).manifest,
    authority.proof.fullName,
  );
  return catalogTransaction(db, async (tx) => {
    await assertLinkedAuthority(tx, authority);
    const [existing] = await tx
      .select()
      .from(probeRevisions)
      .where(
        and(
          eq(probeRevisions.ownerUserId, authority.userId),
          eq(probeRevisions.repositoryLinkId, authority.linkId),
          eq(probeRevisions.digest, definition.digest),
        ),
      );
    if (existing) {
      if (existing.revokedAt) throw new PublicRequestError(409, "probe_revision_revoked");
      return { id: existing.id, digest: existing.digest };
    }
    const counts = (
      await tx.execute<{ own: number; total: number }>(
        sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE owner_user_id=${authority.userId})::int AS own FROM probe_revisions`,
      )
    ).rows[0];
    if (!counts || counts.own >= 10 || counts.total >= 1000)
      throw new PublicRequestError(429, "probe_revision_limit");
    const [row] = await tx
      .insert(probeRevisions)
      .values({
        ownerUserId: authority.userId,
        repositoryLinkId: authority.linkId,
        digest: definition.digest,
        bundle,
      })
      .returning({ id: probeRevisions.id, digest: probeRevisions.digest });
    return row;
  });
}
export async function assertionOverview(db: CatalogDatabase, userId: string) {
  return {
    assertions: (
      await db.execute(
        sql`SELECT id,digest,revoked_at AS "revokedAt",created_at AS "createdAt",repository_link_id AS "repositoryLinkId",bundle->>'repository' AS repository,bundle->>'commit' AS commit,bundle->'manifest' AS manifest FROM probe_revisions WHERE owner_user_id=${userId} ORDER BY created_at DESC LIMIT 10`,
      )
    ).rows,
  };
}
export async function revokeAssertion(db: CatalogDatabase, userId: string, id: string) {
  await catalogTransaction(db, async (tx) => {
    await tx
      .update(probeRevisions)
      .set({ revokedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(probeRevisions.id, id),
          eq(probeRevisions.ownerUserId, userId),
          sql`${probeRevisions.revokedAt} IS NULL`,
        ),
      );
  });
  return { revoked: true };
}
