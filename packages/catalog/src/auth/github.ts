import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { PublicRequestError } from "../public/security.js";
import { authAccounts, repositoryLinks } from "./schema.js";
import type { MaintainerConfig } from "./security.js";

export type Principal = {
  userId: string;
  sessionId: string;
  accountId: string;
  githubId: string;
  name: string;
  email: string;
};
export const repositoryRequestSchema = z.strictObject({
  repository: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/),
  installationId: z.string().regex(/^[1-9][0-9]{0,15}$/),
});
const githubId = z.number().int().positive().safe();
const repositorySchema = z.object({
  id: githubId,
  full_name: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/),
  private: z.boolean(),
  archived: z.boolean(),
  permissions: z.object({
    push: z.boolean().optional(),
    maintain: z.boolean().optional(),
    admin: z.boolean().optional(),
  }),
});
const installationsSchema = z.object({
  installations: z.array(
    z.object({ id: githubId, app_id: githubId, suspended_at: z.string().nullable() }),
  ),
});
const repositoriesSchema = z.object({
  repositories: z.array(z.object({ id: githubId, private: z.boolean() })),
});
export type RepositoryAuthority = {
  revision: string;
  repositoryId: string;
  installationId: string;
  fullName: string;
};
export async function githubJson(path: string, token: string, fetcher = fetch): Promise<unknown> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new TypeError("Invalid GitHub path.");
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "CompatLab",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new PublicRequestError(
      [401, 403, 404].includes(response.status) ? 403 : 503,
      "github_authority_unavailable",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PublicRequestError(503, "github_unavailable");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new PublicRequestError(503, "github_response_too_large");
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function authorityRevision(db: CatalogDatabase | CatalogTransaction) {
  const revision = (
    await db.execute<{ revision: string }>(
      sql`SELECT revision::text FROM auth_authority_state WHERE singleton`,
    )
  ).rows[0]?.revision;
  if (!revision) throw new Error("Authority state is unavailable.");
  return revision;
}
export async function checkRepositoryAuthority(
  db: CatalogDatabase,
  config: MaintainerConfig,
  principal: Principal,
  input: z.infer<typeof repositoryRequestSchema>,
  token: string,
  fetcher = fetch,
): Promise<RepositoryAuthority> {
  const request = repositoryRequestSchema.parse(input);
  const revision = await authorityRevision(db);
  const user = z.object({ id: githubId }).parse(await githubJson("/user", token, fetcher));
  if (String(user.id) !== principal.githubId)
    throw new PublicRequestError(403, "github_identity_changed");
  const repository = repositorySchema.parse(
    await githubJson(`/repos/${request.repository}`, token, fetcher),
  );
  if (
    repository.private ||
    repository.archived ||
    !Object.values(repository.permissions).some(Boolean)
  )
    throw new PublicRequestError(403, "repository_authority_required");
  let installed = false;
  for (let page = 1; page <= 5; page++) {
    const { installations } = installationsSchema.parse(
      await githubJson(`/user/installations?per_page=100&page=${page}`, token, fetcher),
    );
    installed = installations.some(
      (item) =>
        String(item.id) === request.installationId &&
        String(item.app_id) === config.githubAppId &&
        item.suspended_at === null,
    );
    if (installed || installations.length < 100) break;
  }
  if (!installed) throw new PublicRequestError(403, "app_installation_required");
  let accessible = false;
  for (let page = 1; page <= 10; page++) {
    const { repositories } = repositoriesSchema.parse(
      await githubJson(
        `/user/installations/${request.installationId}/repositories?per_page=100&page=${page}`,
        token,
        fetcher,
      ),
    );
    accessible = repositories.some((item) => item.id === repository.id && !item.private);
    if (accessible || repositories.length < 100) break;
  }
  if (!accessible) throw new PublicRequestError(403, "installation_repository_required");
  return {
    revision,
    repositoryId: String(repository.id),
    installationId: request.installationId,
    fullName: repository.full_name,
  };
}
export async function assertCurrentAuthority(
  tx: CatalogTransaction,
  principal: Principal,
  authority: RepositoryAuthority,
) {
  if ((await authorityRevision(tx)) !== authority.revision)
    throw new PublicRequestError(409, "authority_changed_retry");
  const current = await tx.execute(sql`
    SELECT s.id FROM auth_sessions s JOIN auth_accounts a ON a.user_id=s.user_id
    WHERE s.id=${principal.sessionId} AND s.user_id=${principal.userId}
    AND s.expires_at>clock_timestamp() AND a.provider_id='github'
    AND a.account_id=${principal.githubId} AND a.access_token IS NOT NULL
  `);
  if (!current.rows.length) throw new PublicRequestError(401, "sign_in_required");
}
export async function saveRepositoryLink(
  db: CatalogDatabase,
  principal: Principal,
  authority: RepositoryAuthority,
) {
  return catalogTransaction(db, async (tx) => {
    await assertCurrentAuthority(tx, principal, authority);
    const links = await tx
      .select()
      .from(repositoryLinks)
      .where(and(eq(repositoryLinks.userId, principal.userId), isNull(repositoryLinks.revokedAt)));
    if (links.length >= 10 && !links.some((link) => link.repositoryId === authority.repositoryId))
      throw new PublicRequestError(429, "repository_limit");
    const [link] = await tx
      .insert(repositoryLinks)
      .values({
        userId: principal.userId,
        repositoryId: authority.repositoryId,
        installationId: authority.installationId,
        fullName: authority.fullName,
      })
      .onConflictDoUpdate({
        target: [repositoryLinks.userId, repositoryLinks.repositoryId],
        set: {
          installationId: authority.installationId,
          fullName: authority.fullName,
          verifiedAt: new Date(),
          revokedAt: null,
        },
      })
      .returning();
    return link;
  });
}
export async function revokeAccount(db: CatalogDatabase, userId: string) {
  await catalogTransaction(db, async (tx) => {
    await tx
      .update(authAccounts)
      .set({ accessToken: null, refreshToken: null, idToken: null })
      .where(eq(authAccounts.userId, userId));
    await tx.execute(sql`DELETE FROM auth_sessions WHERE user_id=${userId}`);
    await tx
      .update(repositoryLinks)
      .set({ revokedAt: new Date() })
      .where(eq(repositoryLinks.userId, userId));
    await tx.execute(sql`UPDATE auth_authority_state SET revision=revision+1 WHERE singleton`);
  });
}
