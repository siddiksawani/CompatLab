# Maintainer identity and repository authority

GitHub sign-in is optional and disabled by default. Anonymous discovery, reports and one-off scans keep their public interfaces. Account and repository settings are at `/account`. Authentication uses Better Auth 1.7.7, its GitHub provider, PKCE and database-backed OAuth state.

## GitHub App configuration

Create a GitHub App for the deployment origin. Use its OAuth client ID and secret, not an OAuth App or personal token. Enable expiring user access tokens. Set the callback to `https://DOMAIN/api/auth/callback/github`, setup URL to `https://DOMAIN/account`, and webhook to `https://DOMAIN/api/maintainer/github-webhook`.

Required permissions are repository Metadata (mandatory read), Contents (read, for the approved maintainer workflow), and account Email addresses (read, to verify the login email). No repository write permission or organization membership scope is requested. Install on selected public repositories. Receive installation, installation-repositories and user authorization revocation events. The webhook secret must be a random 32-byte lowercase hex value.

Add the following to the private deployment `web.env`, outside the checkout, then restart the web service:

```sh
MAINTAINER_AUTH_ENABLED=true
AUTH_SECRET=<random 32-byte lowercase hex secret>
GITHUB_CLIENT_ID=<App OAuth client ID>
GITHUB_CLIENT_SECRET=<App OAuth client secret>
GITHUB_APP_ID=<numeric App ID>
GITHUB_APP_SLUG=<App slug>
GITHUB_WEBHOOK_SECRET=<random 32-byte lowercase hex secret>
```

The enabled configuration is validated as a complete set. Never expose it as `NEXT_PUBLIC_*` or send it to workers. Apply migration 0005 and `infra/grants.sql` before enabling accounts. The web role handles authentication; control and operator roles can remove expired sessions/state but cannot read profiles, session tokens or encrypted OAuth tokens.

Keep `AUTH_SECRET` in separately secured recovery material. Changing it invalidates sessions and prevents decryption of existing OAuth credentials. For a planned rotation, disable sign-in, clear sessions and encrypted account tokens, rotate the secret and require fresh GitHub sign-in. When restoring an older backup, reconcile subsequent account deletions and revocations before enabling maintainer actions.

## Request and credential boundaries

Caddy limits ordinary bodies to 16 KiB and signed GitHub webhook bodies to 1 MiB. Account mutations have a 2 KiB application limit and require the exact public origin. The authenticated proxy supplies the client address. Atomic database upserts enforce 120 account/auth requests per ten-minute window per daily keyed address across web replicas, with eight in-flight requests per process. Only required auth endpoints are public; token retrieval and social account linking endpoints are excluded.

Sensitive account changes require a session created within ten minutes. Cookies are Secure outside loopback development, HttpOnly and SameSite=Lax. Every session lookup checks PostgreSQL; there is no cookie session cache. OAuth access and refresh tokens use Better Auth's authenticated encryption. Database constraints reject IP and user-agent persistence. Provider tokens never go to the browser. Unexpected authentication failures are handled without logging raw provider or database errors.

## Repository authority and revocation

Link a public, active `owner/repository` and its App installation ID. The server checks the authenticated GitHub user ID, live push/maintain/admin permission, access to this exact App installation, and repository membership in the installation. Enumeration is bounded to 1,000 repositories and 500 installations and fails closed outside those bounds; select fewer repositories if needed.

The label is `repository_authorized`, not npm publisher or artifact ownership. A stored link records a previous check; subsequent maintainer actions must check live authority again. An installation alone is insufficient. Missing GitHub authority or a provider outage rejects privileged actions.

Signed user revocations clear credentials, sessions and repository authority. Installation deletion/suspension and repository removal revoke affected links. Delivery IDs are deduplicated for seven days; later replayed revocations remain safe and conservative. Authority checks carry a database revision so revocation racing a link operation cannot restore access. Account deletion cascades to credentials, sessions and repository configuration while retaining public reports. Local revocation does not uninstall the App from GitHub.

Each account can retain at most ten repository links, including links revoked by GitHub. Remove an old link in account settings to free a slot; linking that same repository again reuses its row. Removing an unknown or already removed link does not change any authorization proof. Token refresh writes compare the stored credentials before updating, so a delayed provider response cannot restore locally revoked credentials. Unexpected account/webhook failures emit only the fixed `maintainer_request_failed` event.

## Quotas and retention

`admission_v4` retains twenty queued scans globally, two active and ten new scans per hour per requester, and a five-minute package/version cooldown. Signed-in requests count the union of matching address history and the stable keyed GitHub account ID. Changing addresses or signing in cannot weaken the anonymous limits. Cached or active equivalent work is reused.

Account and anonymous requester keys expire after seven days. Deleting/recreating an account does not reset this short abuse-prevention window. The bounded maintenance job removes expired sessions/OAuth state, twenty-minute ingress buckets and seven-day webhook IDs. Account configuration stays until deletion; encrypted backups expire after seven days. The public privacy page describes these records.

## Qualification and deployment checks

PostgreSQL tests use the real Better Auth adapter with a mocked GitHub HTTP boundary: PKCE/state replay, encrypted storage/decryption, cookies, CSRF, unavailable token endpoints, fresh sessions, deletion, repository authority, signed/duplicate revocation, a revocation race and atomic quotas. Browser fixtures cover optional accounts, authority labels, stale-session recovery, accessibility and mobile layout.

No live GitHub App is created by these tests. Before enabling accounts publicly, verify one real login, installation, token refresh and revocation with the deployment's App. Public deployment remains a separate release decision.

References: [Better Auth GitHub](https://better-auth.com/docs/authentication/github), [Better Auth options](https://better-auth.com/docs/reference/options), [GitHub App user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Release monitoring, controlled rescans, comparisons and optional email are described in [monitoring](monitoring.md). Background reconciliation uses the encrypted account credentials with live repository checks; an expired browser session does not stop a configured monitor. Revocation does.
