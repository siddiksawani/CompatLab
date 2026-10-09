# Thirty additional packages for public coverage

Reviewed October 9, 2026. This selection adds 30 package names to the 31 names with
eligible package pages at the start of the review. The existing catalog had 33
exact-version pages, and the initial 20-target coverage pilot had completed.

The [import file](qualification/coverage-expansion-2026-10.json) pins the npm
`latest` versions resolved during this review. The
[research snapshot](qualification/coverage-research-2026-10.csv) records exact
versions and download counts for all 46 candidates, including the 16 deferred
candidates. It contains metadata, not package code.

## How we chose them

We reviewed runtime guides, package maintainers' documentation and public
compatibility issues, then checked npm adoption and the existing catalog. The
order below is an editorial priority: concrete runtime questions and useful
loading evidence come first, with adoption as a supporting signal. It is not a
forecast of traffic or a measured keyword-difficulty score.

The npm API returned download totals for October 1–7, 2026, retrieved on October 9.
Downloads include CI and transitive installations; they do not count developers,
Google searches or potential visitors. The CSV preserves the unrounded counts
and dated source URLs. We have no verified keyword-volume dataset for these
queries. Our own lookup-window totals include operator qualification and crawler
traffic, so we did not use those totals as proof of organic demand.

The query phrases below describe the intent to serve. They are suggestions, not
observed Google queries. Upstream issue reports establish that someone encountered
or asked about a problem. A closed issue does not establish a current defect;
an open issue does not establish that our exact versions reproduce it.

## First ten priorities

| Priority | Package and exact version | Weekly downloads | Query intent | Primary evidence and value of a report |
|---|---|---|---|---|
| 1 | `drizzle-orm@0.45.4` | 26.84M | Drizzle Bun compatibility; Drizzle Deno npm | [Bun's Drizzle guide](https://bun.sh/guides/ecosystem/drizzle) uses a runtime-specific adapter. Test published entry points and identify optional adapter prerequisites. A broad subpath result must not imply that every database adapter works everywhere. |
| 2 | `pg@8.23.1` | 62.86M | node-postgres Bun compatibility; pg Deno | A [2026 Deno TLS regression report](https://github.com/denoland/deno/issues/33296), now closed, shows concrete migration friction. A loading report supplies an exact starting point; it cannot validate TLS or concurrent queries. |
| 3 | `bcrypt@6.0.0` | 6.30M | bcrypt Bun; bcrypt Deno npm native addon | [Bun issue 23136](https://github.com/oven-sh/bun/issues/23136), now closed, reports native-module trouble with hot reload. The [package ships Linux prebuilds](https://github.com/kelektiv/node.bcrypt.js). Test native loading with our Linux policy; neither hot reload nor hashing is covered. |
| 4 | `@aws-sdk/client-s3@3.1148.0` | 48.88M | AWS SDK v3 Bun; AWS S3 SDK Deno compatibility | [Deno's S3 example](https://docs.deno.com/examples/s3_upload/) uses this exact package name. Test npm export resolution and its dependency graph. Uploads, credentials and signing need separate integration tests. |
| 5 | `@supabase/supabase-js@2.117.3` | 30.37M | supabase-js Bun compatibility; Supabase Deno npm | [Supabase documents npm imports for Deno](https://supabase.com/docs/reference/javascript/installing), and its [SDK support policy](https://github.com/supabase/supabase-js/blob/master/packages/core/supabase-js/README.md) includes Bun. Our npm-artifact report adds pinned loading evidence, not validation of hosted Edge Functions, auth or Realtime. |
| 6 | `mongodb@7.7.0` | 15.19M | MongoDB Node driver Bun; mongodb Deno npm | [Deno uses the official npm driver](https://docs.deno.com/examples/mongo/). Loading evidence helps migration checks before connecting to a cluster. It does not cover SRV discovery, authentication or queries. |
| 7 | `firebase-admin@14.5.0` | 9.82M | Firebase Admin Deno; firebase-admin Bun compatibility | A [2026 Deno Firestore issue](https://github.com/denoland/deno/issues/33330), now closed, identifies a runtime-dependent hang. Test admin SDK subpaths and prerequisites; successful loading does not settle Firestore transport behavior or credentials. |
| 8 | `jsdom@30.1.2` | 110.71M | jsdom Bun compatibility; jsdom Deno | [Bun issue 43671](https://github.com/oven-sh/bun/issues/43671) remained open at review and names jsdom 30.1.0 in a Vitest worker failure. Test the current package's loading; do not claim to reproduce the macOS/Vitest worker or EventTarget scenario. |
| 9 | `@modelcontextprotocol/sdk@1.32.1` | 65.06M | MCP TypeScript SDK Deno; MCP SDK Bun imports | [Deno subpath/type-resolution issue 2701](https://github.com/modelcontextprotocol/typescript-sdk/issues/2701) remained open at review. Record runtime subpath loading for the widely installed 1.x package. Our scan does not type-check declarations or replace evidence for the separate 2.x server package. |
| 10 | `jose@6.2.12` | 149.53M | jose Bun Deno; jose ESM require compatibility | The [maintainer documents ESM, require and runtime support](https://github.com/panva/jose). This is a useful module-format comparison with `jsonwebtoken`. Loading does not prove support for every cryptographic algorithm. |

## Remaining twenty

| Priority | Package and exact version | Weekly downloads | Query intent | Primary evidence and value of a report |
|---|---|---|---|---|
| 11 | `openai@7.31.0` | 42.62M | OpenAI npm SDK Bun; OpenAI SDK Deno | The [official SDK lists Bun and Deno requirements](https://github.com/openai/openai-node#requirements). Add exact-version import/require evidence. Model calls, uploads and streaming remain outside the scan. |
| 12 | `@anthropic-ai/sdk@0.132.1` | 45.76M | Anthropic TypeScript SDK Bun Deno | The [official SDK lists both runtimes](https://github.com/anthropics/anthropic-sdk-typescript#requirements). Test exports and optional helpers, while preserving any missing-peer classification. API availability and streaming are separate questions. |
| 13 | `ai@7.0.136` | 29.09M | Vercel AI SDK Bun compatibility; AI SDK Deno | [Bun-specific retry handling](https://github.com/vercel/ai/issues/12042) and a [Deno example request](https://github.com/vercel/ai/issues/5760), both closed, establish runtime interest. Test the core package. Provider SDKs and model streams need their own evidence. |
| 14 | `better-auth@1.7.7` | 11.17M | Better Auth Bun; Better Auth Deno compatibility | [Deno has a Better Auth integration example](https://docs.deno.com/examples/better_auth/). Test the published adapter and plugin entry points; database selection, sessions and login behavior require integration tests. |
| 15 | `jsonwebtoken@9.0.3` | 59.03M | jsonwebtoken Bun compatibility; JWT Node Bun | [Bun issue 17899](https://github.com/oven-sh/bun/issues/17899), now closed, reports cross-runtime PS256 differences. This provides a useful comparison with `jose`; loading success cannot validate token interoperability or security. |
| 16 | `mongoose@9.11.1` | 6.54M | Mongoose Bun compatibility; Mongoose Deno | [Deno documents Mongoose setup](https://docs.deno.com/examples/mongoose_tutorial/). Test its loading independently of the underlying MongoDB driver. Models, validation hooks and database operations remain untested. |
| 17 | `mysql2@3.24.5` | 15.82M | mysql2 Bun compatibility; MySQL2 Deno | [Deno's MySQL2 tutorial](https://docs.deno.com/examples/mysql2_tutorial/) uses the npm package. Verify exported loading modes; connections, authentication plugins and SQL execution need separate checks. |
| 18 | `ioredis@6.0.0` | 30.54M | ioredis Bun compatibility; ioredis Deno | [Bun issue 28596](https://github.com/oven-sh/bun/issues/28596), now closed, names ioredis and Postgres.js in a Windows connection problem. Test npm loading, without extrapolating to Windows DNS, Redis connections or cluster behavior. |
| 19 | `postgres@3.4.9` | 20.82M | Postgres.js Bun Deno compatibility | [Postgres.js identifies Node, Deno and Bun as targets](https://github.com/porsager/postgres). Distinguish this npm package from Bun's built-in SQL driver. A loading report does not qualify a connection pool. |
| 20 | `socket.io@4.8.4` | 18.93M | Socket.IO Bun support; Socket.IO Deno compatibility | [Socket.IO documents Bun engine initialization](https://socket.io/docs/v4/server-initialization). Test the core package; its dedicated Bun engine is a separate dependency, and handshakes, transports and reconnects are outside the scan. |
| 21 | `argon2@0.45.1` | 2.62M | node-argon2 Bun; argon2 Deno native addon | The [maintainer documents shipped prebuilt binaries](https://github.com/ranisalt/node-argon2#prebuilt-binaries). A [Bun discussion](https://github.com/oven-sh/bun/discussions/17618) asks about compiled-binary packaging. Our scan checks Linux native loading, not `bun build --compile` or hashing. |
| 22 | `bullmq@6.3.12` | 9.58M | BullMQ Bun compatibility; BullMQ Deno | [BullMQ's connection guide](https://docs.bullmq.io/guide/connections) now covers Bun's Redis adapter, and its [September 2026 changelog](https://docs.bullmq.io/changelog) includes Bun fixes. Loading cannot verify queues, retries or worker-thread behavior. |
| 23 | `@grpc/grpc-js@1.14.6` | 59.28M | grpc-js Bun compatibility; gRPC Deno npm | [Bun issue 40646](https://github.com/oven-sh/bun/issues/40646), now closed, reports response-buffer retention in Bun 1.4. Test the HTTP/2 dependency's loading, not RPC delivery, TLS or memory behavior. |
| 24 | `stripe@23.0.0` | 23.28M | Stripe Node SDK Deno; Stripe SDK Bun | [Stripe documents a Deno export target](https://github.com/stripe/stripe-node#usage-with-deno). Compare published export selection. Payments, webhooks and signature verification require separate integration evidence. |
| 25 | `kysely@0.29.6` | 20.18M | Kysely Bun Deno compatibility | [Kysely documents Deno and Bun installation](https://kysely.dev/docs/getting-started), and its [README lists the runtimes](https://github.com/kysely-org/kysely). Verify core loading; installed database drivers determine dialect behavior. |
| 26 | `@sentry/node@11.6.0` | 38.58M | Sentry Node SDK Deno; Sentry Bun migration | [Deno issue 28330](https://github.com/denoland/deno/issues/28330) tracks Sentry npm/OTel integration. [Bun recommends `@sentry/bun`](https://bun.sh/guides/ecosystem/sentry), a different package. Our Node-SDK loading result does not replace that recommendation or verify instrumentation. |
| 27 | `@opentelemetry/sdk-node@0.223.0` | 19.88M | OpenTelemetry SDK Bun; OpenTelemetry Node SDK Deno | [Bun issue 30669](https://github.com/oven-sh/bun/issues/30669), now closed, names this SDK in a bundling/instrumentation problem. Test the published Node SDK's entry point. Hooking, span export and bundled applications remain untested. |
| 28 | `nodemailer@10.0.16` | 25.12M | Nodemailer Bun import; Nodemailer Deno compatibility | [Bun issue 11323](https://github.com/oven-sh/bun/issues/11323), now closed, reports a missing default export. Current import/require evidence addresses that class of question; SMTP, TLS and message delivery do not run. |
| 29 | `cheerio@1.2.0` | 26.54M | Cheerio Deno import; Cheerio Bun compatibility | [Deno issue 34466](https://github.com/denoland/deno/issues/34466), now closed, names this exact version in a dynamic-import/top-level-await problem. Test normal package loading; our consumer does not reproduce that custom module graph or verify HTML parsing. |
| 30 | `discord.js@14.27.0` | 1.36M | discord.js Bun support; discord.js Deno compatibility | [Bun maintains a Discord.js bot guide](https://bun.sh/guides/ecosystem/discordjs). Its smaller download count still serves a concrete developer use case. Test loading; gateway sessions, voice and Discord API calls require separate tests. |

## Candidates deferred from this batch

We chose one package per overlapping use case where possible, then retained
contrasts such as `pg`/`postgres` and `jose`/`jsonwebtoken` because developers face
different module and runtime requirements.

| Candidates | Reason to defer |
|---|---|
| `knex`, `sequelize`, `typeorm` | More ORM coverage is useful, but Drizzle, Kysely and Mongoose give this batch a broader range of adapters and current runtime guides. |
| `bcryptjs` | A pure-JavaScript alternative worth a later comparison; native bcrypt and argon2 offer more loading uncertainty in this batch. |
| `@google/genai`, `@modelcontextprotocol/server` | Both remain credible follow-ups. This batch includes three AI SDK entry points and the more downloaded MCP 1.x package. The separate MCP 2.x server needs its own report. |
| `@neondatabase/serverless`, `@aws-sdk/lib-storage`, `socket.io-client` | Add these when driver/SDK-specific lookups justify expanding an already covered product family. A related package's report cannot stand in for them. |
| `winston`, `execa`, `chokidar`, `archiver`, `pdfkit` | High adoption alone did not outweigh the selected packages' clearer runtime questions. Process, watcher, archive and document behavior also needs more than loading. |
| `canvas`, `sqlite3` | Their install/native-build requirements can dominate our disabled-lifecycle-script baseline. Start with bcrypt and argon2's shipped prebuilds, then review whether these reports would answer a distinct loading question. |

We also considered the search appeal of Prisma Client, Next.js, Vite and browser
automation tools. They are outside the 46-package metadata snapshot. Their central
questions involve generated clients, full application builds or external browser
binaries. A baseline import report would be weak evidence for those workflows.
Do not label them incompatible because a required build or generation step is absent.

## Execution and search discovery

Import the exact-version file through the existing audited coverage CLI after
reviewing the worker, approved matrix and queue status. Keep its one-at-a-time
execution, ten-new-scans-per-hour quota, foreground priority and outage gates.
No candidate code runs on the developer host or web/control process. The priority
numbers express the research recommendation; the coverage queue does not promise
that JSON array order determines admission order.

A completed scan should produce `/npm/<name>/<version>` with a readable loading
summary, runtime pins, observation time, coverage and a full report link. Preserve
inconclusive outcomes and missing optional-peer requirements. Our platform is
Linux amd64/glibc with lifecycle scripts disabled and no external network during
loading. These reports do not establish functional correctness, performance,
macOS/Windows/arm64 behavior, Deno Deploy or Cloudflare Workers compatibility.

For completed, eligible evidence, verify:

1. The package page and selected report return HTTP 200 through Cloudflare.
2. The server-rendered title, description and summary identify the exact package
   and the Node.js/Bun/Deno loading question without promising application support.
3. The page allows indexing, has its intended canonical URL, and appears in the
   relevant sitemap partition linked from `/sitemap.xml`.
4. The selected report, coverage and outcome agree with the compact public API.

The site already implements those metadata and sitemap paths. No application
change is needed to publish another eligible report. The sitemap was submitted
to Search Console; Google will choose what to crawl and index. Do not create
duplicate pages for permutations such as "works with Bun" and "Bun support".
Use the existing version page for that intent and retain the detailed observation
as its evidence link.

Google recommends useful original evidence and explicitly says that submitting a
[sitemap does not guarantee crawling or indexing](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview).
Our opportunity is a dated, reproducible observation with explicit scope. Broad
queries already have authoritative package and runtime documentation, so the
stronger initial target is the package/version/loading question, not a promise to
outrank those projects for their own names. See Google's
[people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

Evaluate this batch using Search Console's actual package-query impressions,
clicks and indexing results, then useful report/API lookups and repeat use. Keep
observed metrics separate from these selection hypotheses. Expand or change
priorities when that evidence supports it; report count alone is not a traffic KPI.
