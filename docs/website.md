# Anonymous website

The Next.js application in `apps/web` provides public package search, exact-version selection, explicit scan admission, durable progress and report pages. Viewing a package or report never creates execution work. Published tags help select a version but are resolved before admission. Deprecated versions remain selectable with a notice.

## Running the application

Use the pinned Node/pnpm toolchain, install the workspace and apply the [catalog migrations](catalog.md#migrations-and-qualification). Copy `apps/web/.env.example` to `apps/web/.env.local`. Set `DATABASE_URL`, the exact `PUBLIC_ORIGIN`, an approved `PUBLIC_MATRIX_ID`, and a random 32-byte hex `REQUESTER_SECRET`. Generate secrets with `openssl rand -hex 32`. Keep public admission disabled until the operational release gates pass.

```sh
pnpm install --frozen-lockfile
pnpm web:dev
```

The development server listens on `127.0.0.1:3000`. Search uses public npm metadata. Reports require a populated catalog; executing admitted scans requires the private control service and a separately qualified Linux amd64/runsc worker. Never put the Docker socket or worker credentials in the web container. Matrix registration, production ingress and operational setup are documented with the operations slice.

`pnpm web:build` builds the core workspace and a standalone Next.js server. Its root is `apps/web/.next/standalone`; copy `apps/web/.next/static` into its `apps/web/.next/static` directory before running `apps/web/server.js` from that root. Set `HOSTNAME=127.0.0.1` and `PORT=3000` for a host-local reverse proxy. A dedicated container may bind its private network address instead. The deployment slice packages this layout.

## Public boundaries

The web service owns a bounded PostgreSQL pool. It has no package execution path. Registry requests use the engine's bounded client and a 60-second, 4 MiB metadata cache with 64 entries and four concurrent cache fills. Identical fills coalesce. Policy, invalidation and report availability are read from PostgreSQL on each request. Search returns at most ten packages; the version picker suggests at most 200 versions and accepts another exact published version explicitly.

| Route | Purpose |
|---|---|
| `GET /api/v1/search?q=…` | Registry summaries and current report links |
| `GET /api/v1/packages?name=…&version=…` | Exact artifact metadata, version suggestions and current scan/report |
| `POST /api/v1/scans` | Explicit `{ "name": "package", "version": "1.0.0" }` admission |
| `/api/v1/scans/:id`, `/api/v1/reports/:id/…` | [Progress, evidence and downloads](reports.md#reads-and-downloads) |

Admission requires JSON, same-origin headers and a body of at most 2 KiB. Public callers cannot choose commands, runtime images, policies or custom code. Eight API requests may be in flight per application handler, with a separate four-read report limit; saturation returns a bounded retry interval. Database admission atomically deduplicates work and applies requester, package and global queue limits across replicas.

For a non-loopback origin, configure HTTPS and `PROXY_SECRET`. A trusted reverse proxy must **overwrite** `x-compatlab-proxy-token` with this secret and `x-compatlab-client-ip` with the actual client address; do not append user-supplied forwarding values. The application must be unreachable directly from the public network. A spoofed token or address cannot admit work. Requester keys rotate daily with keyed hashing; IPv6 addresses are grouped by /64. Loopback development shares one fixed requester identity and ignores forwarded addresses. Never log these secret headers or raw client addresses.

Pages use a per-response nonce CSP, escaped text, no remote scripts/fonts, and no client-side secrets. Production does not allow inline scripts without a nonce or `eval`. Same-origin JSON routes are not a cross-origin API. Responses avoid shared page caching so historical reports show current quarantine and invalidation state.

## Reports and progress

Polling revalidates persisted revisions, backs off on failures, pauses in hidden tabs and resumes after navigation or refresh. Terminal execution can still be awaiting report assembly; polling continues until a report exists or assembly has exhausted its recovery budget. No artificial completion percentage is shown.

Reports separate shared preparation, runtime/mode/group observations, omissions, coverage, provenance and evidence limitations. Desktop tables become labeled cards on narrow screens. Entry details and sanitized raw logs load on demand. Log expiry and invalidation remain visible. The machine-readable report, exact lock, reproduction descriptor and copyable CLI command retain the evidence's pinned inputs. A successful loading observation does not claim functional correctness or package safety.

## Browser qualification

With a disposable PostgreSQL test server from the catalog guide:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm web:build
COMPATLAB_TEST_DATABASE_URL=postgres://postgres:compatlab-test@127.0.0.1:55432/compatlab_test pnpm test:browser
```

The suite starts the production standalone server against a uniquely named database. A test-process-only registry interceptor and local fixture controller supply authored evidence; neither exists in the production application. These tests verify the web/catalog contract, not package execution or sandbox containment. The separate Linux/runsc gates supply that evidence.

Chromium, Firefox, WebKit and mobile Chromium cover scoped/unscoped discovery, version selection, admission, refresh recovery, cached views without new work, inert malicious logs, expiry, invalidation and missing artifacts. Keyboard navigation, automated WCAG checks, mobile overflow checks and screenshots supplement manual review. On macOS, WebKit uses Option–Tab for link navigation. The required `Browser qualification` CI job runs all four projects on Linux and retains its screenshots/report for seven days.

References: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [nonce CSP](https://nextjs.org/docs/app/guides/content-security-policy), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [Safari keyboard shortcuts](https://help.apple.com/safari/mac/8.0/en.lproj/cpsh003.html).
