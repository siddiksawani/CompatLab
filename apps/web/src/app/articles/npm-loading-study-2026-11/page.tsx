import type { Metadata } from "next";
import { headers } from "next/headers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import { DocumentLayout } from "../../../components/section-navigation";
import { novemberStudyArticle as article, articleDate } from "../../../content/articles";
import study from "../../../content/npm-loading-study-2026-11.json";
import { pageMetadata, publicOrigin } from "../../../server/metadata";

const baseMetadata = pageMetadata(article.title, article.description, article.path);
export const metadata: Metadata = {
  ...baseMetadata,
  authors: [{ name: article.author, url: "https://github.com/siddiksawani/CompatLab" }],
  openGraph: {
    ...baseMetadata.openGraph,
    type: "article",
    publishedTime: article.publishedAt,
    authors: [article.author],
  },
};

const repository = "https://github.com/siddiksawani/CompatLab";
const cohort = `${repository}/blob/${study.cohortCommit}/docs/studies/npm-loading-2026-11/cohort.csv`;

export default async function NovemberStudy() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = publicOrigin();
  const { totals, packages, profiles } = study;
  return (
    <DocumentLayout
      sections={[
        { id: "results", label: "Loading results" },
        { id: "findings", label: "What showed up" },
        { id: "method", label: "Method and limits" },
        { id: "data", label: "Download the data" },
      ]}
    >
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: article.description,
          datePublished: article.publishedAt,
          inLanguage: "en",
          author: { "@type": "Organization", name: article.author, url: origin },
          mainEntityOfPage: origin + article.path,
          citation: [cohort, `${origin}${article.path}/results.json`],
        }).replaceAll("<", "\\u003c")}
      </script>
      <header className="article-header">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Articles", path: "/articles" },
            { name: "November npm loading study", path: article.path },
          ]}
        />
        <h1>{article.title}</h1>
        <p className="muted">
          By {article.author} ·{" "}
          <time dateTime={article.publishedAt}>{articleDate(article.publishedAt)}</time>
        </p>
        <p className="lede">
          <strong>
            {totals.allImportPass} of {packages.length}
          </strong>{" "}
          frozen npm package versions loaded their root with <code>import</code> on all four pinned
          runtime profiles. {totals.allRequirePass} passed the same comparison with{" "}
          <code>require</code>.
        </p>
      </header>

      <h2 id="results">Loading results</h2>
      <p>
        The study attempted {totals.attempted} exact versions. {totals.preparationPass} produced a
        shared npm dependency tree with lifecycle scripts disabled. {totals.inapplicable} frozen
        rows were declaration or binary distributions outside the module-loading test.{" "}
        {totals.missing === 0
          ? "Every eligible row has a report."
          : `${totals.missing} eligible rows lack a report.`}
      </p>
      <section
        className="article-table"
        aria-label="Root loading results by runtime"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this table.
        tabIndex={0}
      >
        <table>
          <caption>
            Root loading outcomes across the frozen {packages.length}-version cohort
          </caption>
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              <th scope="col">Mode</th>
              <th scope="col">Pass</th>
              <th scope="col">Fail</th>
              <th scope="col">Other</th>
            </tr>
          </thead>
          <tbody>
            {profiles.flatMap((profile) =>
              profile.modes.map((mode) => (
                <tr key={`${profile.id}:${mode.mode}`}>
                  <th scope="row">{profile.label}</th>
                  <td>{mode.mode === "esm" ? "import" : "require"}</td>
                  <td>{mode.pass}</td>
                  <td>{mode.fail}</td>
                  <td>{packages.length - mode.pass - mode.fail}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>
      <p>
        Other covers inapplicable entries, preparation limits, incomplete observations, and
        infrastructure outcomes. The downloads give their individual outcomes.{" "}
        {totals.coverageComplete} versions had complete planned coverage, including the explicit
        subpaths that the engine selected.
      </p>

      <h2 id="findings">What showed up</h2>
      {study.findings.map((finding) => (
        <section key={finding.id}>
          <h3>{finding.title}</h3>
          <p>{finding.summary}</p>
          {finding.command ? (
            <pre>
              <code>{finding.command}</code>
            </pre>
          ) : null}
          <p>
            <a href={finding.evidence}>View the underlying evidence</a>
          </p>
        </section>
      ))}

      <h2 id="method">Method and limits</h2>
      <p>
        The <a href={cohort}>frozen cohort</a> ranks 250 candidates from a pinned high-download list
        using npm counts for November 2–8, 2026. Downloads include transitive installs and CI. The
        results describe this sample, which skews toward widely used dependencies.
      </p>
      <p>
        We used npm 11.19.0 with lifecycle scripts disabled and ran on disposable Linux amd64/glibc
        GitHub runners with network-disabled gVisor execution. Deno ran with <code>-A</code> inside
        that boundary and used <code>createRequire()</code> for the CommonJS check. Each root ran in
        a fresh process. Explicit subpaths were checked separately. Wildcard exports were omitted.
      </p>
      <p>
        Loading evaluates the module. Functional calls, upstream test suites, application behavior,
        and other operating systems are outside this measurement. Failed entries are observations
        under this setup. Replay records indicate when a fresh lock-based rebuild produced the same
        observation.
      </p>

      <h2 id="data">Download the data</h2>
      <ul>
        <li>
          <a href={`${article.path}/results.csv`}>Results CSV</a>
        </li>
        <li>
          <a href={`${article.path}/results.json`}>Results, reports, and replay evidence JSON</a>
        </li>
        <li>
          <a href={cohort}>Original package selection and artifact pins</a>
        </li>
        <li>
          <a href={study.runUrl}>Linux/runsc study run</a>
        </li>
        <li>
          <a href={`${repository}/blob/${study.cohortCommit}/docs/npm-loading-study-2026-11.md`}>
            Study protocol
          </a>
        </li>
      </ul>
    </DocumentLayout>
  );
}
