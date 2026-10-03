import { createHmac } from "node:crypto";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import {
  type PublicConfig,
  PublicRequestError,
  readAdmissionBody,
  requesterKey,
} from "../public/security.js";
import { fenceTokenRefresh, refreshFence } from "./adapter.js";
import {
  checkRepositoryAuthority,
  type Principal,
  repositoryRequestSchema,
  revokeAccount,
  saveRepositoryLink,
} from "./github.js";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  repositoryLinks,
} from "./schema.js";
import {
  accountRequesterKey,
  type MaintainerConfig,
  maintainerConfigSchema,
  privateJson,
  takeRequestBudget,
} from "./security.js";
import { receiveGithubWebhook } from "./webhook.js";

export function createGithubAuth(
  db: CatalogDatabase,
  publicConfig: PublicConfig,
  config: MaintainerConfig,
): ReturnType<typeof betterAuth> {
  const adapter = drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authUsers,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
    transaction: true,
  });
  return betterAuth<BetterAuthOptions>({
    appName: "CompatLab",
    baseURL: publicConfig.origin,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [publicConfig.origin],
    database: (options: BetterAuthOptions) => fenceTokenRefresh(adapter(options)),
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        disableDefaultScope: true,
        scope: [],
        mapProfileToUser: (profile) => ({ name: profile.login, image: "" }),
      },
    },
    emailAndPassword: { enabled: false },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
      storeStateStrategy: "database",
      storeAccountCookie: false,
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      freshAge: 600,
      cookieCache: { enabled: false },
    },
    user: { deleteUser: { enabled: true } },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { disableIpTracking: true },
      useSecureCookies: publicConfig.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }),
        },
      },
    },
    // The ingress limiter is atomic across replicas and never stores raw addresses.
    rateLimit: { enabled: false },
    logger: { disabled: true },
    onAPIError: { throw: true, errorURL: `${publicConfig.origin}/account?error=sign_in_failed` },
  });
}

export function createMaintainerService(
  db: CatalogDatabase,
  publicConfig: PublicConfig,
  rawConfig: MaintainerConfig,
  fetcher = fetch,
) {
  const config = maintainerConfigSchema.parse(rawConfig);
  const auth = createGithubAuth(db, publicConfig, config);
  let inFlight = 0;
  async function principal(request: Request, fresh = false): Promise<Principal | null> {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    if (fresh && Date.now() - new Date(session.session.createdAt).getTime() > 600_000)
      throw new PublicRequestError(403, "fresh_sign_in_required");
    const [account] = await db
      .select({
        id: authAccounts.id,
        githubId: authAccounts.accountId,
        accessToken: authAccounts.accessToken,
      })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, session.user.id), eq(authAccounts.providerId, "github")));
    if (!account?.accessToken || !session.user.emailVerified) return null;
    return {
      userId: session.user.id,
      sessionId: session.session.id,
      accountId: account.id,
      githubId: account.githubId,
      name: session.user.name,
      email: session.user.email,
    };
  }
  async function requirePrincipal(request: Request, fresh = false) {
    const user = await principal(request, fresh);
    if (!user) throw new PublicRequestError(401, "sign_in_required");
    return user;
  }
  async function accessToken(request: Request) {
    try {
      const user = await requirePrincipal(request);
      const [account] = await db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.id, user.accountId));
      if (!account?.accessToken) throw new PublicRequestError(403, "github_sign_in_required");
      const result = await refreshFence.run(
        { id: account.id, accessToken: account.accessToken, refreshToken: account.refreshToken },
        () =>
          auth.api.getAccessToken({
            headers: request.headers,
            body: { accountId: user.accountId },
          }),
      );
      if (!result.accessToken) throw new Error("No token.");
      return result.accessToken;
    } catch {
      throw new PublicRequestError(403, "github_sign_in_required");
    }
  }
  async function authorize(
    request: Request,
    user: Principal,
    input: z.infer<typeof repositoryRequestSchema>,
  ) {
    return checkRepositoryAuthority(db, config, user, input, await accessToken(request), fetcher);
  }
  async function handler(request: Request): Promise<Response> {
    if (inFlight >= 8) return privateJson({ error: "busy" }, 503);
    inFlight++;
    try {
      const path = new URL(request.url).pathname;
      if (path === "/api/maintainer/github-webhook" && request.method === "POST") {
        await receiveGithubWebhook(db, request, config.githubWebhookSecret, config.githubAppId);
        return privateJson({ received: true });
      }
      const address = requesterKey(request, publicConfig);
      const key = createHmac("sha256", config.secret).update(`maintainer:${address}`).digest("hex");
      await takeRequestBudget(db, key, 120);
      if (path.startsWith("/api/auth/")) return await authRequest(request, path);
      if (path === "/api/maintainer/account" && request.method === "GET") {
        const user = await principal(request);
        return privateJson({
          enabled: true,
          user: user ? { name: user.name, email: user.email } : null,
          installationUrl: `https://github.com/apps/${config.githubAppSlug}/installations/new`,
          repositories: user
            ? await db.select().from(repositoryLinks).where(eq(repositoryLinks.userId, user.userId))
            : [],
        });
      }
      if (request.method !== "POST") return privateJson({ error: "not_found" }, 404);
      const body = await readAdmissionBody(request, publicConfig.origin);
      const user = await requirePrincipal(request, true);
      if (path === "/api/maintainer/repositories") {
        const authority = await authorize(request, user, repositoryRequestSchema.parse(body));
        return privateJson(await saveRepositoryLink(db, user, authority), 201);
      }
      if (path === "/api/maintainer/repositories/revoke") {
        const { id } = z.strictObject({ id: z.uuid() }).parse(body);
        await catalogTransaction(db, async (tx) => {
          await tx
            .update(repositoryLinks)
            .set({ revokedAt: new Date() })
            .where(and(eq(repositoryLinks.id, id), eq(repositoryLinks.userId, user.userId)));
          await tx.execute(
            sql`UPDATE auth_authority_state SET revision=revision+1 WHERE singleton`,
          );
        });
        return privateJson({ revoked: true });
      }
      if (path === "/api/maintainer/revoke") {
        z.strictObject({}).parse(body);
        await revokeAccount(db, user.userId);
        return privateJson({ revoked: true });
      }
      return privateJson({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof PublicRequestError)
        return privateJson({ error: error.code }, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return privateJson({ error: "invalid_request" }, 400);
      return privateJson({ error: "temporarily_unavailable" }, 503);
    } finally {
      inFlight--;
    }
  }
  async function authRequest(request: Request, path: string): Promise<Response> {
    if (path === "/api/auth/callback/github" && request.method === "GET")
      return auth.handler(request);
    if (
      request.method !== "POST" ||
      !["/api/auth/sign-in/social", "/api/auth/sign-out", "/api/auth/delete-user"].includes(path)
    )
      return privateJson({ error: "not_found" }, 404);
    const body = await readAdmissionBody(request, publicConfig.origin);
    let forwarded: unknown = {};
    if (path === "/api/auth/sign-in/social") {
      z.strictObject({ provider: z.literal("github") }).parse(body);
      forwarded = {
        provider: "github",
        callbackURL: `${publicConfig.origin}/account`,
        errorCallbackURL: `${publicConfig.origin}/account?error=sign_in_failed`,
        disableRedirect: true,
      };
    } else {
      z.strictObject({}).parse(body);
      if (path === "/api/auth/delete-user") await requirePrincipal(request, true);
    }
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const response = await auth.handler(
      new Request(request.url, { method: "POST", headers, body: JSON.stringify(forwarded) }),
    );
    response.headers.set("cache-control", "no-store");
    return response;
  }
  return {
    handler,
    principal,
    requirePrincipal,
    authorize,
    accessToken,
    async quotaKey(request: Request) {
      const user = await principal(request);
      return user ? accountRequesterKey(publicConfig.requesterSecret, user.githubId) : undefined;
    },
  };
}
export type MaintainerService = ReturnType<typeof createMaintainerService>;
