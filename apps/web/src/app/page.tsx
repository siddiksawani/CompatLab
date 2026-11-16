import { searchResponseSchema } from "@compatlab/contracts";
import { headers } from "next/headers";
import { labels, readError } from "../components/labels";
import { ReportPreviewCard } from "../components/report-preview";
import { Search } from "../components/search";
import {
  compatibilityArticle,
  mcpArticle,
  migrationArticle,
  novemberStudyArticle,
} from "../content/articles";
import loadingStudy from "../content/npm-loading-study-2026-11.json";
import { exampleReports, recentReports } from "../server/discovery";
import { pageMetadata, publicOrigin } from "../server/metadata";
import { publicRead } from "../server/runtime";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, unknown>>;
}) {
  const query = await searchParams;
  const title = "CompatLab — npm compatibility for Node.js, Bun and Deno";
  const metadata = pageMetadata(
    title,
    "CompatLab is an open-source npm compatibility checker. Compare recorded import and require results across pinned Node.js, Bun and Deno runtimes.",
    "/",
    Object.keys(query).length === 0,
  );
  return { ...metadata, title: { absolute: title }, openGraph: { ...metadata.openGraph, title } };
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${publicOrigin()}/#website`,
    name: "CompatLab",
    alternateName: "compatlab.me",
    url: `${publicOrigin()}/`,
    sameAs: ["https://github.com/siddiksawani/CompatLab"],
  };
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  let packages: ReturnType<typeof searchResponseSchema.parse>["packages"] = [];
  let error = "";
  const recent = await recentReports();
  const examples = await exampleReports(recent);
  const featured = examples.find((report) => report.outcome === "pass" && report.coverageComplete);
  if (query) {
    const response = await publicRead(`/api/v1/search?${new URLSearchParams({ q: query })}`);
    if (response.ok) packages = searchResponseSchema.parse(await response.json()).packages;
    else error = readError(response.status);
  }
  return (
    <>
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(website).replaceAll("<", "\\u003c")}
      </script>
      <section className="hero">
        <div className="hero-search">
          <h1>
            {loadingStudy.totals.allImportPass} of {loadingStudy.packages.length} npm packages
            imported on Node.js, Bun and Deno
          </h1>
          <p className="lede">
            The study measured root imports on four pinned runtime versions. Search for an exact npm
            version to compare its import and require results.
          </p>
          <Search initialQuery={query} initialPackages={packages} initialError={error} />
          <div className="hero-links">
            <a className="text-link" href={novemberStudyArticle.path}>
              {novemberStudyArticle.title}
            </a>
            <a className="text-link" href={mcpArticle.path}>
              Connect an AI agent with MCP
            </a>
          </div>
          {examples.length > 0 && (
            <section className="examples" aria-label="Example reports">
              <span>Open a completed report</span>
              {examples.map((report) => (
                <a key={report.id} href={`/reports/${report.id}`}>
                  <span>{report.artifact.name}</span>
                  <small>{labels[report.outcome]}</small>
                </a>
              ))}
            </section>
          )}
        </div>
        {featured ? (
          <ReportPreviewCard report={featured} />
        ) : (
          <aside className="preview-empty">
            <h2>Browse the test results</h2>
            <p>The directory shows observed loading results for exact npm versions.</p>
            <a className="text-link" href="/npm/compatibility">
              npm compatibility directory →
            </a>
          </aside>
        )}
      </section>
      {recent.length > 0 && (
        <section className="page recent-reports" aria-labelledby="recent-reports-title">
          <h2 id="recent-reports-title">Recently tested</h2>
          <p>
            <a href="/npm/compatibility">Browse all tested npm package versions</a>
          </p>
          <ul className="recent-report-list">
            {recent.map((report) => (
              <li key={report.id}>
                <a href={`/reports/${report.id}`}>
                  <strong>{report.name}</strong>
                  <span className="recent-report-meta">
                    <span className="mono">{report.version}</span>
                    <span className={`result ${report.outcome}`}>{labels[report.outcome]}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="page article-callout" aria-labelledby="article-title">
        <h2 id="article-title">
          <a href={compatibilityArticle.path}>{compatibilityArticle.title}</a>
        </h2>
        <p>
          Express loads, Preact needs a peer for two subpaths, and Zod’s wildcard exports leave a
          coverage gap. Read the results and what they mean for your application.
        </p>
      </section>
      <section className="page article-callout" aria-labelledby="migration-article-title">
        <h2 id="migration-article-title">
          <a href={migrationArticle.path}>{migrationArticle.title}</a>
        </h2>
        <p>
          Match the versions in your lockfile to the imports in your code. Use the Axios, Zod, Sharp
          and gRPC examples to pick the next test for your application.
        </p>
      </section>
      <section className="cli-callout">
        <div>
          <h2>Run the same checks on your own Linux host</h2>
          <p>
            The engine and CLI are open source. Each report includes the inputs and runtime versions
            you need to reproduce it.
          </p>
          <a className="text-link" href="/methodology#local-cli">
            CLI setup and requirements →
          </a>
        </div>
        <pre>
          <code>compatlab check express@5.2.1 --json</code>
        </pre>
      </section>
    </>
  );
}
