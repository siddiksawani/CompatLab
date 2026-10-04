import { sql } from "drizzle-orm";
import type { CatalogReader } from "../database.js";
export const assertionSelectionAllowed = sql`(s.assertion_revision_id IS NULL OR EXISTS(SELECT 1 FROM probe_revisions ar WHERE ar.id=s.assertion_revision_id AND ar.revoked_at IS NULL AND ar.owner_user_id IS NOT NULL AND ar.repository_link_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blocks ab WHERE ab.revoked_at IS NULL AND ((ab.scope='probe' AND ab.subject=ar.digest) OR (ab.scope='harness' AND ab.subject='assertion_v1')))))`;
export async function allowedAssertion(db: CatalogReader, id: string | null) {
  if (!id) return true;
  return (
    (
      await db.execute(
        sql`SELECT id FROM probe_revisions ar WHERE ar.id=${id} AND ar.revoked_at IS NULL AND ar.owner_user_id IS NOT NULL AND ar.repository_link_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.revoked_at IS NULL AND ((b.scope='probe' AND b.subject=ar.digest) OR (b.scope='harness' AND b.subject='assertion_v1')))`,
      )
    ).rows.length > 0
  );
}
