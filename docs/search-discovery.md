# Search discovery

The canonical site is `https://compatlab.me`. Public editorial pages and completed, current, policy-eligible reports have titles, descriptions, canonical URLs and social metadata. The homepage links to six recent eligible reports and up to three completed examples. Its matrix preview projects outcomes, coverage and runtime pins from stored evidence without loading entry details or package logs. The examples use the same eligibility rules as the sitemap and fall back to recent packages when no curated examples are available. These reads never request a scan. Historical report URLs continue to work even when they leave search discovery.

Search/version queries, progress, comparisons, history and the deferred account page carry `noindex`. API and health responses send `X-Robots-Tag: noindex, nofollow`. Robots permits crawling so search engines can see those instructions; `robots.txt` is not an access-control mechanism. Invalid IDs use the normal 404 behavior.

Submit `/sitemap.xml`, an index of the editorial sitemap and sixteen report partitions. Each report partition uses the first hexadecimal digit of its UUID and its existing primary-key range, without offset pagination or loading report payloads. A separate partial index supports the six recent homepage links. Reads are bounded to 50,000 URLs per partition, with at most two discovery queries in flight per web process. If a partition fills, it returns an error rather than silently dropping URLs; increase prefix depth before that threshold. A busy or unavailable database returns HTTP 503 with a retry hint. Sitemap responses are not cached, so invalidation, policy blocks and runtime quarantine take effect on the next read.

Indexing is limited to completed reports. It does not depend on a passing outcome and does not imply package safety, functional correctness or publisher endorsement. Canonical report URLs identify exact observations; rescans retain separate provenance.

## Search Console after launch

1. Open [Google Search Console](https://search.google.com/search-console) and sign in to the Google account that should own CompatLab.
2. Open the property selector, choose **Add property**, select **Domain**, enter `compatlab.me`, and choose **Continue**.
3. Copy the displayed TXT verification value. In Cloudflare, open **compatlab.me → DNS → Records → Add record**. Choose **TXT**, enter `@` as the name, paste the value into **Content**, keep automatic TTL, and save.
4. Return to Search Console and choose **Verify**. Keep the TXT record after verification.
5. In **Sitemaps**, enter `https://compatlab.me/sitemap.xml` and submit it.
6. Use **URL inspection** for the homepage and one completed report. Run **Test live URL**, check that crawling/indexing is allowed and the canonical URL matches, then choose **Request indexing** if offered.

The account owner must perform Google ownership verification. Sitemaps and metadata help discovery; search engines decide whether and when to index or rank a page.

References: [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [Next.js sitemap guidance](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap), [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
