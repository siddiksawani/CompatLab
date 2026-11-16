import type { Metadata } from "next";
import { headers } from "next/headers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import { DocumentLayout } from "../../../components/section-navigation";
import { behaviorStudyArticle as article, articleDate } from "../../../content/articles";
import study from "../../../content/npm-behavior-study-2026-11.json";
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
const protocol = `${repository}/tree/${study.sourceCommit}/docs/studies/npm-behavior-2026-11`;

export default async function BehaviorStudy() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = publicOrigin();
  return (
    <DocumentLayout
      sections={[
        { id: "findings", label: "What differed" },
        { id: "cohort", label: "All 24 packages" },
        { id: "suites", label: "Upstream tests" },
        { id: "method", label: "Method and limits" },
        { id: "data", label: "Data and reproduction" },
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
          citation: [protocol, `${origin}${article.path}/raw-results.json`],
        }).replaceAll("<", "\\u003c")}
      </script>
      <header className="article-header">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Articles", path: "/articles" },
            { name: "npm behavior study", path: article.path },
          ]}
        />
        <h1>{article.title}</h1>
        <p className="muted">
          By {article.author} ·{" "}
          <time dateTime={article.publishedAt}>{articleDate(article.publishedAt)}</time>
        </p>
        <p className="lede">{study.headline}</p>
        <p>
          Our <a href="/articles/npm-loading-study-2026-11">first study of 100 npm versions</a>{" "}
          found that 97 passed root import on all four tested profiles. Loading was the boundary of
          that measurement. This follow-up calls package APIs and runs upstream tests against 24
          deliberately selected versions.
        </p>
        <p>
          These cases target native addons and Node-specific APIs. They do not estimate the failure
          rate of npm, Bun, or Deno as a whole.
        </p>
      </header>
      <h2 id="findings">What differed after loading</h2>
      {study.findings.map((finding) => (
        <section key={finding.id}>
          <h3>{finding.title}</h3>
          <p>{finding.summary}</p>
          <pre>
            <code>{finding.command}</code>
          </pre>
          <p>
            <a href={finding.evidence}>Evidence and upstream context</a>
          </p>
        </section>
      ))}
      <h2 id="cohort">Every frozen package is accounted for</h2>
      <p>{study.coverage}</p>
      <p>
        The table shows each package’s primary behavior case, or its upstream suite when no separate
        named case was used. A pass covers that case only. Baseline failure means the matching Node
        test did not pass, so that row cannot establish an alternative-runtime regression.
      </p>
      <section
        className="article-table"
        aria-label="Behavior results for all 24 packages"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the evidence table.
        tabIndex={0}
      >
        <table>
          <caption>Linux amd64, Node.js 26.10.0, Bun 1.4.2, Deno 2.9.7</caption>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Case</th>
              <th scope="col">Node.js</th>
              <th scope="col">Bun</th>
              <th scope="col">Deno</th>
            </tr>
          </thead>
          <tbody>
            {study.packages.map((row) => (
              <tr key={row.name} id={`package-${row.name}`}>
                <th scope="row">
                  <code>
                    {row.name}@{row.version}
                  </code>
                </th>
                <td>{row.scope}</td>
                <td>{row.node}</td>
                <td>{row.bun}</td>
                <td>{row.deno}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p>{study.rootImports}</p>
      <h2 id="suites">What the upstream suites actually covered</h2>
      <p>
        We attempted JavaScript suites for nine versions. Eight use the listed JavaScript unit
        suites; CLS-hooked uses an explicitly bounded subset. Lint, type checks, in-browser
        execution, coverage instrumentation and upstream release builds are outside this tier.
        Counts are test cases for Jest/Mocha/node:test and TAP assertions for Split2/End-of-stream;
        they are not comparable between packages. Mocha uses <code>--exit</code> after its
        assertions, so suite completion does not establish a leak-free process lifetime.
      </p>
      <section
        className="article-table"
        aria-label="Upstream test suite coverage"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the evidence table.
        tabIndex={0}
      >
        <table>
          <caption>Suite completion and coverage, separate from the named probes</caption>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Node.js</th>
              <th scope="col">Bun</th>
              <th scope="col">Deno</th>
              <th scope="col">Scope or limitation</th>
            </tr>
          </thead>
          <tbody>
            {study.suites.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.node}</td>
                <td>{row.bun}</td>
                <td>{row.deno}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p>{study.suiteInterpretation}</p>
      <h2 id="deno-followup">Deno follow-up: completing the Import-fresh suite</h2>
      <p>
        <strong>{study.denoFollowup.date}.</strong> {study.denoFollowup.summary}
      </p>
      <p>
        The remaining failures concern a hook-registration spy and three CommonJS import-attribute
        expectations. They need separate interpretation. Read the{" "}
        <a href={study.denoFollowup.evidence}>follow-up protocol, controls and raw receipts</a> or
        the <a href={study.denoFollowup.upstream}>upstream context-leak report</a>.
      </p>
      <h2 id="method">Method and limits</h2>
      <ul>
        <li>
          <strong>Selection.</strong>{" "}
          <a
            href={`${repository}/blob/${study.cohortCommit}/docs/studies/npm-behavior-2026-11/cohort.json`}
          >
            All 24 artifacts were frozen before the pilot.
          </a>{" "}
          The list includes exact versions, npm integrity and source commits where npm supplies
          them. No unsuccessful package was removed.
        </li>
        <li>
          <strong>Preparation.</strong> One locked npm install with scripts disabled prepared the
          shared dependency tree. Separate offline gVisor containers ran the recorded bcrypt,
          esbuild, canvas and better-sqlite3 steps. This measures shared Node/npm preparation, not
          three independent package-manager installs.
        </li>
        <li>
          <strong>Environment.</strong> Runs used pinned Linux amd64 Debian Bookworm images, gVisor,
          non-root users, resource limits and no external network during execution. Local loopback
          servers were allowed. Deno used full permissions with offline resolution. The raw receipts
          contain run dates, versions, image IDs, compiler details and exact commands.
        </li>
        <li>
          <strong>Completion.</strong> Named probes require zero exit and the expected completion
          file after their assertions. Asynchronous probes await their work. Children in the named
          subprocess and worker cases report their runtime identity. Suite completion and
          assertion/skip counts are checked separately.
        </li>
        <li>
          <strong>Failure checks.</strong> Every non-pass was replayed in a fresh container. Reduced
          cases and matched controls separate runtime API gaps, baseline failures, test-harness
          assumptions, timeouts and missing prerequisites. Known upstream issues are linked; an open
          fix is not a released fix.
        </li>
        <li>
          <strong>Scope.</strong> These results describe the listed cases, exact versions and this
          OS sandbox. They do not certify whole applications, all APIs, all platforms, security or
          performance. Some suites assume Node-specific child arguments or executable names. Their
          failures need interpretation before attributing them to a runtime.
        </li>
      </ul>
      <p>{study.audit}</p>
      <p>
        Public <a href="/">CompatLab reports</a> continue to describe loading observations. The
        research does not turn a loading badge into a behavior certificate. For an application
        migration, use the{" "}
        <a href="/articles/node-to-bun-deno-dependency-checklist">dependency checklist</a> and test
        the calls your code actually makes.
      </p>
      <h2 id="data">Raw results and reproduction</h2>
      <p>
        Commands above run inside the prepared study container, from <code>/study</code>. Follow the{" "}
        <a href={protocol}>pinned runner and protocol</a> to prepare the same inputs on a disposable
        Linux amd64 host with gVisor. The public hosted scanner does not run these custom tests.
      </p>
      <ul>
        <li>
          <a href={`${article.path}/results.csv`}>Every observation and classification as CSV</a>
        </li>
        <li>
          <a href={`${article.path}/results.json`}>
            Study summary, package rows and triage as JSON
          </a>
        </li>
        <li>
          <a href={`${article.path}/raw-results.json`}>
            Raw commands, logs, exit statuses, completion records and replays
          </a>
        </li>
        <li>
          <a href={`${repository}/tree/main/docs/studies/npm-behavior-2026-11/results`}>
            Versioned raw results in GitHub
          </a>
        </li>
        <li>
          <a href={study.runUrl}>Full-cohort GitHub Actions run</a>
        </li>
        <li>
          <a href={protocol}>
            Frozen inputs, source hashes, dependency lock and reproduction protocol
          </a>
        </li>
      </ul>
    </DocumentLayout>
  );
}
