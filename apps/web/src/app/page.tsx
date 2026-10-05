import { searchResponseSchema } from "@compatlab/contracts";
import { labels, readError } from "../components/labels";
import { ReportPreviewCard } from "../components/report-preview";
import { Search } from "../components/search";
import { exampleReports, recentReports } from "../server/discovery";
import { pageMetadata } from "../server/metadata";
import { publicRead } from "../server/runtime";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, unknown>>;
}) {
  const query = await searchParams;
  return pageMetadata(
    "Check npm packages across Node.js, Bun and Deno",
    "See whether an npm package imports and requires in Node.js, Bun and Deno. Compare real loading results, check coverage and inspect exact tested versions.",
    "/",
    Object.keys(query).length === 0,
  );
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  let packages: ReturnType<typeof searchResponseSchema.parse>["packages"] = [];
  let error = "";
  const recent = await recentReports();
  const examples = await exampleReports(recent);
  if (query) {
    const response = await publicRead(`/api/v1/search?${new URLSearchParams({ q: query })}`);
    if (response.ok) packages = searchResponseSchema.parse(await response.json()).packages;
    else error = readError(response.status);
  }
  return (
    <>
      <section className="hero">
        <div className="hero-search">
          <h1>Check your package in Node.js, Bun and Deno.</h1>
          <p className="lede">
            See whether it loads with import and require. Pick a version, compare the results and
            open the details when a check fails.
          </p>
          <Search initialQuery={query} initialPackages={packages} initialError={error} />
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
          <p className="hero-method">
            We test published npm packages on Linux with exact runtime versions. Install scripts
            stay disabled. <a href="/methodology">Read how the checks work.</a>
          </p>
        </div>
        {examples[0] ? (
          <ReportPreviewCard report={examples[0]} />
        ) : (
          <aside className="preview-empty">
            <h2>No completed reports yet</h2>
            <p>
              Search for a package and request a scan. Its report will show the loading results for
              each runtime.
            </p>
          </aside>
        )}
      </section>
      {recent.length > 0 && (
        <section className="page recent-reports" aria-labelledby="recent-reports-title">
          <h2 id="recent-reports-title">Recently tested</h2>
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
