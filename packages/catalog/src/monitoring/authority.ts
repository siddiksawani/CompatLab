import { sql } from "drizzle-orm";
import { authorityRevision, type RepositoryAuthority } from "../auth/github.js";
import type { CatalogTransaction } from "../database.js";
import { PublicRequestError } from "../public/security.js";
export type LinkedAuthority = {
  userId: string;
  accountId: string;
  githubId: string;
  linkId: string;
  proof: RepositoryAuthority;
  sessionId?: string;
};
export async function assertLinkedAuthority(tx: CatalogTransaction, authority: LinkedAuthority) {
  if ((await authorityRevision(tx)) !== authority.proof.revision)
    throw new PublicRequestError(409, "authority_changed_retry");
  const row =
    await tx.execute(sql`SELECT a.id FROM auth_accounts a JOIN auth_users u ON u.id=a.user_id JOIN repository_links l ON l.user_id=u.id
 WHERE a.id=${authority.accountId} AND u.id=${authority.userId} AND a.account_id=${authority.githubId} AND a.access_token IS NOT NULL AND u.email_verified
 AND l.id=${authority.linkId} AND l.revoked_at IS NULL AND l.repository_id=${authority.proof.repositoryId} AND l.installation_id=${authority.proof.installationId}
 AND (${authority.sessionId ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM auth_sessions s WHERE s.id=${authority.sessionId ?? null} AND s.user_id=u.id AND s.expires_at>clock_timestamp()))`);
  if (!row.rows.length) throw new PublicRequestError(403, "repository_authority_required");
}
export function assertRepository(manifest: Record<string, unknown>, fullName: string) {
  const field = manifest.repository;
  const value =
    typeof field === "string"
      ? field
      : field && typeof field === "object" && "url" in field
        ? field.url
        : undefined;
  if (typeof value !== "string" || value.length > 2048)
    throw new PublicRequestError(403, "package_repository_mismatch");
  const normalized = value.replace(/^git\+/, "").replace(/\.git$/, "");
  const match =
    /^(?:(?:https?:\/\/|git:\/\/|ssh:\/\/(?:git@)?)github\.com\/|git@github\.com:|github:)?([A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100})$/.exec(
      normalized,
    );
  if (match?.[1]?.toLowerCase() !== fullName.toLowerCase())
    throw new PublicRequestError(403, "package_repository_mismatch");
}
