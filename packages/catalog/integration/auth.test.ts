import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { admitScan } from "../src/admission.js";
import { checkRepositoryAuthority, revokeAccount, saveRepositoryLink } from "../src/auth/github.js";
import { createMaintainerService } from "../src/auth/runtime.js";
import { authAccounts, authSessions, authUsers, repositoryLinks } from "../src/auth/schema.js";
import { accountRequesterKey, takeRequestBudget } from "../src/auth/security.js";
import { receiveGithubWebhook } from "../src/auth/webhook.js";
import {
  artifact,
  database,
  hash,
  migrateCatalog,
  options,
  seedMatrix,
  seedReport,
} from "./fixtures.js";

const origin = "https://compatlab.example";
const publicConfig = {
  origin,
  requesterSecret: "a".repeat(64),
  proxySecret: "b".repeat(64),
  matrixId: randomUUID(),
  scansEnabled: true,
};
const config = {
  secret: "c".repeat(64),
  githubClientId: "Iv1.fixture",
  githubClientSecret: "d".repeat(40),
  githubAppId: "72",
  githubAppSlug: "compatlab-test",
  githubWebhookSecret: "e".repeat(64),
};
let catalog: Awaited<ReturnType<typeof database>>;
let identity = 100;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => {
  await catalog?.dispose();
});
afterEach(() => vi.unstubAllGlobals());

function request(
  path: string,
  body?: unknown,
  cookie = "",
  method = body === undefined ? "GET" : "POST",
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      cookie,
      "x-compatlab-proxy-token": publicConfig.proxySecret,
      "x-compatlab-client-ip": `198.51.100.${identity % 250}`,
      "user-agent": "test-private-user-agent",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function signedIn() {
  const id = ++identity;
  let permission = true;
  let privateRepository = false;
  let appId = 72;
  let duringRefresh: (() => Promise<void>) | undefined;
  const token = `ghu_fixture_${id}`;
  const refreshToken = `ghr_fixture_${id}`;
  const fetched = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://github.com/login/oauth/access_token") {
      const refresh = String(init?.body).includes("grant_type=refresh_token");
      if (!refresh) expect(String(init?.body)).toContain("code_verifier=");
      if (refresh) await duringRefresh?.();
      return Response.json({
        access_token: refresh ? `${token}_renewed` : token,
        refresh_token: refresh ? `${refreshToken}_renewed` : refreshToken,
        token_type: "bearer",
        expires_in: 28800,
        refresh_token_expires_in: 15552000,
        scope: "",
      });
    }
    if (url === "https://api.github.com/user")
      return Response.json({
        id,
        login: `maintainer-${id}`,
        name: "Fixture Maintainer",
        email: `${id}@example.com`,
        avatar_url: "https://avatars.example/unused",
      });
    if (url === "https://api.github.com/user/emails")
      return Response.json([{ email: `${id}@example.com`, primary: true, verified: true }]);
    if (url === "https://api.github.com/repos/owner/package")
      return Response.json({
        id: 510,
        full_name: "owner/package",
        private: privateRepository,
        archived: false,
        permissions: { push: permission },
      });
    if (url.startsWith("https://api.github.com/user/installations?"))
      return Response.json({ installations: [{ id: 91, app_id: appId, suspended_at: null }] });
    if (url.startsWith("https://api.github.com/user/installations/91/repositories?"))
      return Response.json({ repositories: [{ id: 510, private: false }] });
    throw new Error(`Unexpected test HTTP request: ${url}`);
  });
  vi.stubGlobal("fetch", fetched);
  const service = createMaintainerService(catalog.db, publicConfig, config, fetched);
  const start = await service.handler(request("/api/auth/sign-in/social", { provider: "github" }));
  expect(start.status).toBe(200);
  const authorization = new URL(((await start.json()) as { url: string }).url);
  expect(authorization.origin).toBe("https://github.com");
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const callback = `/api/auth/callback/github?code=fixture&state=${authorization.searchParams.get("state")}`;
  const oauthCookie = cookies(start);
  const finish = await service.handler(request(callback, undefined, oauthCookie));
  expect(finish.status).toBe(302);
  expect(finish.headers.get("location")).toBe(`${origin}/account`);
  const cookie = cookies(finish);
  const user = await service.requirePrincipal(
    request("/api/maintainer/account", undefined, cookie),
  );
  return {
    service,
    cookie,
    user,
    token,
    refreshToken,
    id,
    fetched,
    callback,
    oauthCookie,
    finish,
    onRefresh: (callback: () => Promise<void>) => {
      duringRefresh = callback;
    },
    deny: () => {
      permission = false;
      privateRepository = false;
      appId = 72;
    },
    makePrivate: () => {
      privateRepository = true;
    },
    wrongApp: () => {
      appId = 73;
    },
  };
}
it("runs GitHub OAuth with PKCE, encrypted tokens and private server sessions", async () => {
  const fixture = await signedIn();
  const [account] = await catalog.db
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.userId, fixture.user.userId));
  expect(account?.accessToken).toBeTruthy();
  expect(account?.accessToken).not.toContain(fixture.token);
  expect(account?.refreshToken).not.toContain(fixture.refreshToken);
  expect(await fixture.service.accessToken(request("/account", undefined, fixture.cookie))).toBe(
    fixture.token,
  );
  expect(
    fixture.finish.headers
      .getSetCookie()
      .some(
        (value) =>
          value.includes("HttpOnly") && value.includes("Secure") && value.includes("SameSite=Lax"),
      ),
  ).toBe(true);
  const [session] = await catalog.db
    .select()
    .from(authSessions)
    .where(eq(authSessions.id, fixture.user.sessionId));
  expect(session).toMatchObject({ ipAddress: null, userAgent: null });
  const view = await fixture.service.handler(
    request("/api/maintainer/account", undefined, fixture.cookie),
  );
  const body = await view.text();
  expect(body).toContain(`maintainer-${fixture.id}`);
  expect(body).not.toContain(fixture.token);
  expect(body).not.toContain(session?.token);
  const replay = await fixture.service.handler(
    request(fixture.callback, undefined, fixture.oauthCookie),
  );
  expect(replay.headers.get("location")).toContain("error=");
});
it("refreshes expiring GitHub App credentials without returning them to the browser", async () => {
  const fixture = await signedIn();
  await catalog.db
    .update(authAccounts)
    .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(authAccounts.userId, fixture.user.userId));
  expect(await fixture.service.accessToken(request("/account", undefined, fixture.cookie))).toBe(
    `${fixture.token}_renewed`,
  );
  const [account] = await catalog.db
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.userId, fixture.user.userId));
  expect(account?.refreshToken).not.toContain(fixture.refreshToken);
  expect(account?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
});
it("redacts unexpected adapter errors instead of logging credentials or database parameters", async () => {
  const fixture = await signedIn();
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  await catalog.pool.query(
    "CREATE FUNCTION fail_auth_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-credential'; END $$",
  );
  await catalog.pool.query(
    "CREATE TRIGGER fail_auth BEFORE INSERT ON auth_verifications FOR EACH ROW EXECUTE FUNCTION fail_auth_fixture()",
  );
  try {
    const response = await fixture.service.handler(
      request("/api/auth/sign-in/social", { provider: "github" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic-credential");
    expect(output).not.toHaveBeenCalled();
  } finally {
    await catalog.pool.query("DROP TRIGGER fail_auth ON auth_verifications");
    await catalog.pool.query("DROP FUNCTION fail_auth_fixture()");
    output.mockRestore();
  }
});
it("rejects cross-site mutations, unexposed token routes and browser-selected OAuth scopes", async () => {
  const { service, cookie } = await signedIn();
  const crossSite = request("/api/auth/sign-out", {}, cookie);
  crossSite.headers.set("origin", "https://attacker.example");
  expect((await service.handler(crossSite)).status).toBe(403);
  expect((await service.handler(request("/api/auth/get-access-token", {}, cookie))).status).toBe(
    404,
  );
  expect(
    (
      await service.handler(
        request("/api/auth/sign-in/social", { provider: "github", scopes: ["repo"] }),
      )
    ).status,
  ).toBe(400);
  expect(await service.principal(request("/account", undefined, `${cookie}tampered`))).toBeNull();
  const unsigned = await service.handler(
    request("/api/auth/callback/github?code=fixture&state=forged"),
  );
  expect(unsigned.headers.get("location")).toContain("error=");
});
it("requires both user repository authority and this App's public installation access", async () => {
  const fixture = await signedIn();
  const input = { repository: "owner/package", installationId: "91" };
  expect(
    (await fixture.service.handler(request("/api/maintainer/repositories", input, fixture.cookie)))
      .status,
  ).toBe(201);
  const [link] = await catalog.db
    .select()
    .from(repositoryLinks)
    .where(eq(repositoryLinks.userId, fixture.user.userId));
  expect(link).toMatchObject({
    authority: "repository_authorized",
    repositoryId: "510",
    installationId: "91",
  });
  fixture.wrongApp();
  expect(
    (await fixture.service.handler(request("/api/maintainer/repositories", input, fixture.cookie)))
      .status,
  ).toBe(403);
  fixture.makePrivate();
  expect(
    (await fixture.service.handler(request("/api/maintainer/repositories", input, fixture.cookie)))
      .status,
  ).toBe(403);
  fixture.deny();
  expect(
    (await fixture.service.handler(request("/api/maintainer/repositories", input, fixture.cookie)))
      .status,
  ).toBe(403);
});
function webhook(body: object, event: string, delivery = randomUUID(), valid = true) {
  const bytes = JSON.stringify(body);
  return new Request(`${origin}/api/maintainer/github-webhook`, {
    method: "POST",
    body: bytes,
    headers: {
      "x-github-event": event,
      "x-github-delivery": delivery,
      "x-hub-signature-256": `sha256=${createHmac(
        "sha256",
        valid ? config.githubWebhookSecret : "invalid",
      )
        .update(bytes)
        .digest("hex")}`,
    },
  });
}
it("fences authority checks racing a signed revocation and rejects forged or duplicate events", async () => {
  const fixture = await signedIn();
  const proof = await checkRepositoryAuthority(
    catalog.db,
    config,
    fixture.user,
    { repository: "owner/package", installationId: "91" },
    fixture.token,
    fixture.fetched,
  );
  await saveRepositoryLink(catalog.db, fixture.user, proof);
  const body = { action: "revoked", sender: { id: fixture.id } };
  await expect(
    receiveGithubWebhook(
      catalog.db,
      webhook(body, "github_app_authorization", randomUUID(), false),
      config.githubWebhookSecret,
      config.githubAppId,
    ),
  ).rejects.toThrow("invalid_webhook_signature");
  const delivery = randomUUID();
  await receiveGithubWebhook(
    catalog.db,
    webhook(body, "github_app_authorization", delivery),
    config.githubWebhookSecret,
    config.githubAppId,
  );
  await receiveGithubWebhook(
    catalog.db,
    webhook(body, "github_app_authorization", delivery),
    config.githubWebhookSecret,
    config.githubAppId,
  );
  expect(
    (
      await catalog.pool.query("SELECT count(*)::int AS count FROM github_deliveries WHERE id=$1", [
        delivery,
      ])
    ).rows[0].count,
  ).toBe(1);
  await expect(saveRepositoryLink(catalog.db, fixture.user, proof)).rejects.toThrow(
    "authority_changed_retry",
  );
  expect(
    await fixture.service.principal(request("/account", undefined, fixture.cookie)),
  ).toBeNull();
  expect(
    (
      await catalog.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, fixture.user.userId))
    )[0],
  ).toMatchObject({ accessToken: null, refreshToken: null });
  expect(
    (
      await catalog.db
        .select()
        .from(repositoryLinks)
        .where(eq(repositoryLinks.userId, fixture.user.userId))
    )[0]?.revokedAt,
  ).toBeInstanceOf(Date);
});
it("deletes account-linked configuration while preserving public reports and requires a fresh session", async () => {
  const fixture = await signedIn();
  const matrixId = (await seedMatrix(catalog.db)).matrixId;
  const report = await seedReport(catalog.db, matrixId);
  await fixture.service.handler(
    request(
      "/api/maintainer/repositories",
      { repository: "owner/package", installationId: "91" },
      fixture.cookie,
    ),
  );
  await catalog.db
    .update(authSessions)
    .set({ createdAt: new Date(Date.now() - 700_000) })
    .where(eq(authSessions.id, fixture.user.sessionId));
  expect(
    (await fixture.service.handler(request("/api/auth/delete-user", {}, fixture.cookie))).status,
  ).toBe(403);
  await catalog.db
    .update(authSessions)
    .set({ createdAt: new Date() })
    .where(eq(authSessions.id, fixture.user.sessionId));
  expect(
    (await fixture.service.handler(request("/api/auth/delete-user", {}, fixture.cookie))).status,
  ).toBe(200);
  expect(
    await catalog.db.select().from(authUsers).where(eq(authUsers.id, fixture.user.userId)),
  ).toEqual([]);
  expect(
    await catalog.db
      .select()
      .from(repositoryLinks)
      .where(eq(repositoryLinks.userId, fixture.user.userId)),
  ).toEqual([]);
  expect(
    (await catalog.pool.query("SELECT id FROM reports WHERE id=$1", [report.report.id])).rowCount,
  ).toBe(1);
});
it("enforces atomic ingress and account quotas across different client addresses", async () => {
  const key = hash(randomUUID());
  const requests = await Promise.allSettled(
    Array.from({ length: 12 }, () => takeRequestBudget(catalog.db, key, 5)),
  );
  expect(requests.filter((item) => item.status === "fulfilled")).toHaveLength(5);
  const matrixId = (await seedMatrix(catalog.db)).matrixId;
  const accountKey = accountRequesterKey(publicConfig.requesterSecret, "500");
  for (let index = 0; index < 2; index++)
    expect(
      await admitScan(catalog.db, artifact(), { ...options(matrixId), accountKey }),
    ).toMatchObject({ kind: "admitted" });
  expect(
    await admitScan(catalog.db, artifact(), { ...options(matrixId), accountKey }),
  ).toMatchObject({ kind: "throttled", reason: "requester_limit" });
  expect(await admitScan(catalog.db, artifact(), options(matrixId))).toMatchObject({
    kind: "admitted",
  });
});

it("cannot restore credentials when revocation races an OAuth refresh", async () => {
  const fixture = await signedIn();
  await catalog.db
    .update(authAccounts)
    .set({ accessTokenExpiresAt: new Date(0) })
    .where(eq(authAccounts.userId, fixture.user.userId));
  fixture.onRefresh(() => revokeAccount(catalog.db, fixture.user.userId));
  await expect(
    fixture.service.accessToken(request("/account", undefined, fixture.cookie)),
  ).rejects.toThrow("github_sign_in_required");
  expect(
    (
      await catalog.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, fixture.user.userId))
    )[0],
  ).toMatchObject({ accessToken: null, refreshToken: null });
});
