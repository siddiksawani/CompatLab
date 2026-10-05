# Anonymous website

The Next.js application in `apps/web` provides public package search, exact-version selection, explicit scan admission, durable progress and report pages. Viewing a package or report never creates execution work. Published tags help select a version but are resolved before admission. Deprecated versions remain selectable with a notice.

The Maintainers page explains the planned release monitoring, comparisons and offline behavioral checks and marks them **Coming soon**. It does not load account APIs or expose sign-in, repository linking, monitoring or assertion controls. Report links point to this explanation instead of offering unavailable rescans. Existing public history, comparisons and historical assertion evidence remain readable.

The homepage pairs search with a matrix from a completed report. It reads up to three current examples for Preact, Express and Zod, using the same eligibility rules as search discovery. These examples cover mixed results, successful loading and incomplete coverage; they do not claim differences between runtimes that the observations did not show. Example links open completed reports without scheduling work. If those packages have no eligible reports, the page uses recent eligible packages; an empty catalog shows an empty state. The preview query selects only matrix, outcome and coverage fields, without entry-level evidence or logs.

The version picker is a native select menu containing up to 200 recent versions plus the selected version. A separate, labeled form accepts another exact version, including older versions outside that menu. Both forms work without JavaScript. Header navigation links to search, methodology and GitHub. Documentation uses a reading column and a desktop section list; reports retain the wider matrix and a section bar. Section navigation returns to normal document flow on smaller screens. The footer includes the loading limitation and a direct removal-policy link.

## Running the application

Use the pinned Node/pnpm toolchain, install the workspace and apply the [catalog migrations](catalog.md#migrations-and-qualification). Copy `apps/web/.env.example` to `apps/web/.env.local`. Set `DATABASE_URL`, the exact `PUBLIC_ORIGIN`, an approved `PUBLIC_MATRIX_ID`, and a random 32-byte hex `REQUESTER_SECRET`. Generate secrets with `openssl rand -hex 32`. Keep public admission disabled until the operational release gates pass.

```sh
pnpm install --frozen-lockfile
pnpm web:dev
```

The development server listens on `127.0.0.1:3000`. Search uses public npm metadata. Reports require a populated catalog; executing admitted scans requires the private control service and a separately qualified Linux amd64/runsc worker. Never put the Docker socket or worker credentials in the web container. Matrix registration, production ingress and operational setup are documented with the operations slice.

`pnpm web:build` builds the core workspace and a standalone Next.js server. Its root is `apps/web/.next/standalone`; copy `apps/web/.next/static` into its `apps/web/.next/static` directory before running `apps/web/server.js` from that root. Set `HOSTNAME=127.0.0.1` and `PORT=3000` for a host-local reverse proxy. A dedicated container may bind its private network address instead. The deployment slice packages this layout.

## Public boundaries

The web service owns a bounded PostgreSQL pool. It has no package execution path. Registry requests use the engine's bounded client and a 60-second, 4 MiB metadata cache with 64 entries and four concurrent cache fills. Identical fills coalesce. Policy, invalidation and report availability are read from PostgreSQL on each request; search resolves all returned package/version pairs in one query. Search returns at most ten packages; the version picker lists recent published versions and accepts another exact published version through its separate form.

| Route | Purpose |
|---|---|
| `GET /api/v1/search?q=…` | Registry summaries and current report links |
| `GET /api/v1/packages?name=…&version=…` | Exact artifact metadata, version suggestions and current scan/report |
| `POST /api/v1/scans` | Explicit `{ "name": "package", "version": "1.0.0" }` admission |
| `/api/v1/scans/:id`, `/api/v1/reports/:id/…` | [Progress, evidence and downloads](reports.md#reads-and-downloads) |

Admission requires JSON, same-origin headers and a body of at most 2 KiB. Public callers cannot choose commands, runtime images, policies or custom code. Eight API requests may be in flight per application handler, with a separate four-read report limit; saturation returns a bounded retry interval. Database admission atomically deduplicates work and applies requester, package and global queue limits across replicas.

For a non-loopback origin, configure HTTPS and `PROXY_SECRET`. A trusted reverse proxy must **overwrite** `x-compatlab-proxy-token` with this secret and `x-compatlab-client-ip` with the actual client address; do not append user-supplied forwarding values. The application must be unreachable directly from the public network. A spoofed token or address cannot admit work. Requester keys rotate daily with keyed hashing; IPv6 addresses are grouped by /64; IPv4-mapped addresses use their underlying IPv4 identity. Loopback development shares one fixed requester identity and ignores forwarded addresses. Never log these secret headers or raw client addresses.

Pages use a per-response nonce CSP, escaped text, no remote scripts/fonts, and no client-side secrets. Production does not allow inline scripts without a nonce or `eval`. Same-origin JSON routes are not a cross-origin API. Responses avoid shared page caching so historical reports show current quarantine and invalidation state.

## Reports and progress

Polling revalidates persisted revisions, backs off on failures, pauses in hidden tabs and resumes after navigation or refresh. Terminal execution can still be awaiting report assembly; polling continues until a report exists or assembly has exhausted its recovery budget. No artificial completion percentage is shown. Timestamps use a consistent `YYYY-MM-DD HH:mm UTC` display on the server and in the browser.

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

Layout checks cover 320, 390, 768, 1024, 1440, 1920 and 2560 pixel viewports, including long package names and URLs, expanded evidence, clipboard fallback, history/comparison forms, policy pages and unavailable states. They check page gutters and centering, horizontal overflow, overlapping controls and footer placement. Tablet reports use two columns of runtime cards; narrow screens use one.

References: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [nonce CSP](https://nextjs.org/docs/app/guides/content-security-policy), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [Safari keyboard shortcuts](https://help.apple.com/safari/mac/8.0/en.lproj/cpsh003.html).
