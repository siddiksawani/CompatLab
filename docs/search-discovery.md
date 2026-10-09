# Search discovery

The canonical site is `https://compatlab.me`. Public editorial pages and completed, current, policy-eligible reports have titles, descriptions, canonical URLs and social metadata. The homepage links to six recent eligible reports and up to three completed examples. Its matrix preview projects outcomes, coverage and runtime pins from stored evidence without loading entry details or package logs. The examples use the same eligibility rules as the sitemap and fall back to recent packages when no curated examples are available. These reads never request a scan. Historical report URLs continue to work even when they leave search discovery.

Search/version queries, progress, comparisons, history and the deferred account page carry `noindex`. JSON API and health responses send `X-Robots-Tag: noindex, nofollow`; the human-readable `/api` guide is indexable. Robots permits crawling so search engines can see those instructions; `robots.txt` is not an access-control mechanism. Invalid IDs use the normal 404 behavior.

Submit `/sitemap.xml`, an index of the editorial sitemap, sixteen report partitions and sixteen package/version partitions. Each report partition uses the first hexadecimal digit of its UUID and its existing primary-key range, without offset pagination or loading report payloads. A separate partial index supports the six recent homepage links. Reads are bounded to 50,000 URLs per partition, with at most two discovery queries in flight per web process. If a partition fills, it returns an error rather than silently dropping URLs; increase prefix depth before that threshold. A busy or unavailable database returns HTTP 503 with a retry hint. Sitemap responses are not cached, so invalidation, policy blocks and runtime quarantine take effect on the next read.

Report indexing is limited to completed reports. It does not depend on a passing outcome and does not imply package safety, functional correctness or publisher endorsement. Canonical report URLs identify exact observations; rescans retain separate provenance.

## Exact-version pages and compact evidence

`/npm/express/5.2.1` and `/npm/@scope/name/1.0.0` are server-rendered, self-canonical version summaries. They select eligible baseline evidence using the same current-matrix preference and earlier-matrix fallback as public discovery, without a registry request. Only exact versions are accepted. No eligible evidence means a 404, not a compatibility verdict; registry selection and explicit scan requests remain at `/packages`. Reads never create work.

The version page answers the loading question with recorded runtime versions, outcomes, original observation time, coverage and optional prerequisites. It links the complete observation and its provenance. The selected report can change after a rescan or reclassification; `/reports/:id` remains the immutable observation URL to cite. Both pages retain their own canonical URL because the version summary and detailed observation serve different purposes. This does not guarantee that a search engine indexes both.

`/sitemaps/npm-{prefix}.xml` partitions packages by the first digit of their package UUID, then deduplicates exact versions. Its policy, baseline/classifier and terminal-state filters match version-page selection, including finished inconclusive observations. It uses bounded queries and the shared two-query discovery limit. No last-modified time is invented for the changing selection. Invalidated, replaced, blocked, quarantined and integrity-anomaly evidence is excluded. UUID report sitemaps remain unchanged.

`GET /api/v1/reports/:id/summary` projects the retained payload in PostgreSQL before transfer. It excludes entry records, session details, static manifest data, planner omission samples and named assertions. It preserves status, artifact identity, preparation, runtime image pins, dates, policy revisions, limitations and all per-group outcomes/coverage. Per-runtime outcomes use the existing deterministic combination rule; no new compatibility classification is introduced. Group failures are representative, not exhaustive. Optional peer requirements come from retained entry classifications, are deduplicated and bounded to sixteen, and expose a truncation flag. The full report retains all original evidence. `reportPath` supplies the observation path relative to the site origin. HEAD, ETags and status changes behave like the full report API.

The optional `/llms.txt` reading guide links real public resources and states the citation, status and read-only rules. HTTP `Link` headers advertise it with `rel="describedby"`. It follows the [community proposal](https://llmstxt.org/); it is not a promise that every agent will discover or use the site. Content Signals and the decision to decline training are unchanged. Package/version pages currently serve HTML; report pages retain their Markdown alternatives.

Before releasing new discovery paths, extend the existing Cloudflare public-read exception to `/npm/` and `/llms.txt`, keeping its host, GET/HEAD and Browser Integrity Check-only scope. Verify public reads through the edge and confirm account routes and scan POST requests retain their existing protections.

## Articles

`/articles` lists server-rendered editorial pages. The first article, `/articles/npm-package-compatibility-node-bun-deno`, links four observed reports and records the package/runtime versions and review date. Article metadata supplies a canonical URL, publication date, author, social preview and nonce-bearing `TechArticle` structured data. The editorial sitemap, homepage and footer link to the article or index; the homepage Markdown also links it. Articles do not depend on live registry or scan requests.

Editorial tables summarize fixed historical observations, not automatically refreshed compatibility claims. Check source report invalidation and evidence before publishing or revising an article. A report link can outlive its cached snapshot and raw logs; removal or invalidation may require an editorial correction. Cross-posts must point their canonical URL at the original article. Maintainer accounts and public badges remain deferred.

## Agent discovery

Package and search responses retain `reportId` for eligible baseline reports under the current matrix and classifier. The additive `availableReport` field also exposes the same exact package version under another approved matrix when no current-matrix report exists. It includes the original observation time, outcome, coverage, matrix identity and `matchesCurrentMatrix`. Exact package lookup additionally matches the registry's artifact integrity. Invalidated, replaced, policy-blocked, quarantined and obsolete-classifier reports are excluded; assertion runs are not substituted for baseline results. Snapshot expiry alone does not remove retained evidence. Search uses one batched catalog query for at most ten results.

An active scan and stored evidence are selected independently. A newer unfinished scan cannot hide an eligible completed report. The package page offers earlier evidence alongside a separate current-environment scan or progress action; reads do not admit work. Older clients can continue using `reportId`, and new clients accept responses without `availableReport` during a rolling deployment. `status.current` on a report describes invalidation, replacement and policy eligibility, not whether it uses the latest package version or current execution matrix.

Public pages advertise the API catalog, OpenAPI specification and human guide through HTTP `Link` relations. The RFC 9727 catalog at `/.well-known/api-catalog` returns `application/linkset+json` with an actual API endpoint as its anchor, plus service description, documentation and health links. The specification covers existing anonymous reads only; it creates no new execution or authentication path.

The homepage and `/reports/:id` negotiate `text/markdown` when explicitly preferred in `Accept`. Wildcards and ordinary browser requests keep HTML; React navigation and prefetch requests are excluded. `skipProxyUrlNormalize` preserves the framework's navigation headers for this decision. `/index.md` and `/reports/:id/markdown` are explicit alternatives, with canonical links to the HTML pages and `noindex` to avoid duplicate search entries. Markdown uses the same bounded public reads, discloses historical status and coverage, and links to full evidence rather than copying package stdout. Missing reports remain 404s. Other documentation pages do not yet offer Markdown.

The application renders Markdown itself. Keep Caddy's `no-transform` protection on HTML; Cloudflare HTML conversion previously broke hydration. Caddy also appends `Vary: Accept` to HTML, preserving Next.js's own variant headers (Next.js replaces custom HTML `Vary` headers during rendering). Markdown sets `Vary: Accept` in its route handler. Both formats disable shared caching. No paid Cloudflare conversion feature is required. Verify both variants through the production proxy after deployment, not just the local Next.js port.

Content Signals in `robots.txt` and response headers allow search and AI answers, and decline model training: `search=yes, ai-input=yes, ai-train=no`. These are published preferences, not a guarantee that crawlers comply or a substitute for authorization.

Use [Is It Agent Ready](https://isitagentready.com/compatlab.me) after deployment to verify discovery, Markdown, robot rules and content signals. Its score also checks optional protocols. CompatLab does not implement OAuth, agent registration (`auth.md`), MCP, A2A, WebMCP, Agent Skills, DNS-AID or agent commerce; do not publish placeholder metadata to claim support. Add a protocol only with its real endpoint, behavior, security review and tests. A scanner score is not a security or execution qualification.

References: [API catalogs, RFC 9727](https://www.rfc-editor.org/rfc/rfc9727), [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html), [Markdown negotiation](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/), [Content Signals](https://contentsignals.org/).

## Search Console after launch

1. Open [Google Search Console](https://search.google.com/search-console) and sign in to the Google account that should own CompatLab.
2. Open the property selector, choose **Add property**, select **Domain**, enter `compatlab.me`, and choose **Continue**.
3. Copy the displayed TXT verification value. In Cloudflare, open **compatlab.me → DNS → Records → Add record**. Choose **TXT**, enter `@` as the name, paste the value into **Content**, keep automatic TTL, and save.
4. Return to Search Console and choose **Verify**. Keep the TXT record after verification.
5. In **Sitemaps**, enter `https://compatlab.me/sitemap.xml` and submit it.
6. Use **URL inspection** for the homepage and one completed report. Run **Test live URL**, check that crawling/indexing is allowed and the canonical URL matches, then choose **Request indexing** if offered.

The account owner must perform Google ownership verification. Sitemaps and metadata help discovery; search engines decide whether and when to index or rank a page.

References: [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [Next.js sitemap guidance](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap), [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
