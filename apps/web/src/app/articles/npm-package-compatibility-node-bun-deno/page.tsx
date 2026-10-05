import type { Metadata } from "next";
import { headers } from "next/headers";
import { DocumentLayout } from "../../../components/section-navigation";
import { compatibilityArticle as article } from "../../../content/articles";
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

const reports = {
  express: "/reports/9368053f-f1bb-43cc-95e0-7c8e938fcb4c",
  preact: "/reports/cb8cdf3c-7a5d-41c6-9380-1175eb69811c",
  zod: "/reports/673f4173-fdec-4d29-a02d-d0cf6f20b08d",
  agent: "/reports/c060462b-103e-4704-9522-431d02acfce3",
};

export default async function CompatibilityArticle() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = publicOrigin();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    inLanguage: "en",
    author: {
      "@type": "Organization",
      name: article.author,
      url: "https://github.com/siddiksawani/CompatLab",
    },
    publisher: { "@type": "Organization", name: "CompatLab", url: origin },
    mainEntityOfPage: origin + article.path,
    image: `${origin}/opengraph-image`,
    citation: Object.values(reports).map((path) => origin + path),
  };
  return (
    <DocumentLayout
      sections={[
        { id: "results", label: "The results" },
        { id: "express", label: "Express: loading passes" },
        { id: "preact", label: "Preact: missing peer" },
        { id: "zod", label: "Zod: coverage matters" },
        { id: "agent", label: "Different runtime errors" },
        { id: "method", label: "How we test" },
        { id: "your-package", label: "Check your package" },
      ]}
    >
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(structuredData).replaceAll("<", "\\u003c")}
      </script>
      <header className="article-header">
        <a href="/articles">Articles</a>
        <h1>{article.title}</h1>
        <p className="muted">
          By {article.author} · <time dateTime={article.publishedAt}>October 5, 2026</time>
        </p>
        <p className="lede">
          Express loaded in all four runtime profiles. Preact’s root did too, but two of its
          subpaths failed. Zod passed 80 loading checks and still received an inconclusive result.
          Each finding answers a different part of the compatibility question.
        </p>
      </header>
      <p>
        You have a Node.js application and want to try Bun or Deno. Before changing the start
        command, you need to know whether your dependencies will load. A package’s README may name
        Node versions, but it rarely covers the exact package release, import style and alternative
        runtime you intend to use.
      </p>
      <p>
        We built <a href="/">CompatLab</a> to collect that evidence. You select an exact published
        npm version, and we check its entry points across pinned Node.js, Bun and Deno runtimes. You
        can inspect the loading failures, coverage and environment in a public report. The engine is{" "}
        <a href="https://github.com/siddiksawani/CompatLab">open source</a>.
      </p>
      <h2 id="results">Four packages, with the reports attached</h2>
      <p>
        We reviewed these reports on October 5, 2026. Each uses Linux amd64 with glibc, Node.js
        24.21.0, Node.js 26.10.0, Bun 1.4.2 and Deno 2.9.7. Install scripts stay disabled. Within
        each report, the runtimes read the same prepared dependency files.
      </p>
      <section
        className="article-table"
        aria-label="Package loading results"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this table.
        tabIndex={0}
      >
        <table>
          <caption>Recorded checks across four runtimes and both loading modes</caption>
          <thead>
            <tr>
              <th scope="col">Package and report</th>
              <th scope="col">Root checks</th>
              <th scope="col">Subpath checks</th>
              <th scope="col">Overall result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                <a href={reports.express}>express@5.2.1</a>
              </th>
              <td>8 passed</td>
              <td>None planned</td>
              <td>Passed</td>
            </tr>
            <tr>
              <th scope="row">
                <a href={reports.preact}>preact@11.0.0</a>
              </th>
              <td>8 passed</td>
              <td>96 passed · 16 failed</td>
              <td>Mixed results</td>
            </tr>
            <tr>
              <th scope="row">
                <a href={reports.zod}>zod@4.6.5</a>
              </th>
              <td>8 passed</td>
              <td>72 passed · wildcard omitted</td>
              <td>Inconclusive</td>
            </tr>
            <tr>
              <th scope="row">
                <a href={reports.agent}>@convex-dev/agent@0.7.3</a>
              </th>
              <td>8 passed</td>
              <td>24 passed · 16 failed</td>
              <td>Mixed results</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p>
        Eight root checks means one ESM <code>import</code> and one CommonJS <code>require</code>{" "}
        for each of the four runtime profiles. Counts measure loading operations, not distinct
        features. These selected examples are not a representative sample of npm and do not rank the
        runtimes. Reports also record exact image and dependency identities; a matching version
        number alone does not make two scans identical.
      </p>
      <h2 id="express">Express loads; your HTTP application still needs tests</h2>
      <p>
        In the <a href={reports.express}>Express 5.2.1 report</a>, import and require passed on both
        Node.js versions, Bun and Deno. The planner selected no explicit executable subpaths, so the
        result covers those eight root operations.
      </p>
      <p>
        That gives you a concrete first answer about npm package compatibility: this release
        resolved and evaluated in those environments. We did not start an Express server, send
        requests, exercise middleware or connect to a database. Before migrating an application, run
        its integration tests under the runtime you plan to deploy.
      </p>
      <h2 id="preact">Preact’s missing peer explains a mixed result</h2>
      <p>
        <a href={reports.preact}>Preact 11.0.0</a> passed its root checks across the matrix. Each
        runtime and loading mode then passed 12 of 14 subpath checks. The two failures were
        <code> preact/compat/server</code> and <code>preact/compat/server.browser</code>.
      </p>
      <p>
        The retained errors identify a missing <code>preact-render-to-string</code> dependency.
        Preact’s <a href="https://registry.npmjs.org/preact/11.0.0">published manifest</a> declares
        it as an optional peer. The consumer workspace for this report installed Preact alone. A
        project that uses those server-rendering entry points needs to account for that peer.
      </p>
      <p>
        The useful next step is to install the intended peer in your application and test its
        server-rendering path. We have not performed that follow-up in this report, so we cannot
        claim it resolves the full workflow. The observed failure affects this dependency snapshot
        on all four profiles; it does not establish a Bun-only or Deno-only defect.
      </p>
      <h2 id="zod">Zod passes its checks, but the wildcard remains untested</h2>
      <p>
        <a href={reports.zod}>Zod 4.6.5</a> passed both root modes and nine explicit subpaths per
        mode on all four profiles: 80 passed loading operations and zero recorded failures.
        CompatLab still labels the report inconclusive because the published export map also
        contains <code>./v4/locales/*</code>.
      </p>
      <p>
        The current planner checks explicit executable exports and records wildcard patterns as
        omitted coverage. We cannot claim complete coverage of that package’s exports from these
        observations. If your application imports a particular locale, include that import in your
        own tests. Passing the observed entries and covering all public entries are separate
        requirements.
      </p>
      <h2 id="agent">The same failed subpath can produce different runtime errors</h2>
      <p>
        In <a href={reports.agent}>@convex-dev/agent 0.7.3</a>, all root checks passed. Each subpath
        batch passed three entries and failed two. The <code>/react</code> entry lacked React in
        this snapshot. The <code>/test</code> entry exposed a different distinction:
      </p>
      <section
        className="article-table"
        aria-label="Test subpath errors"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this table.
        tabIndex={0}
      >
        <table>
          <caption>ESM loading of @convex-dev/agent/test in the linked report</caption>
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              <th scope="col">Recorded failure</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Node.js 24.21.0 and 26.10.0</th>
              <td>Type stripping under node_modules is unsupported.</td>
            </tr>
            <tr>
              <th scope="row">Bun 1.4.2</th>
              <td>
                <code>import.meta.glob is not a function</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Deno 2.9.7</th>
              <td>Type stripping under node_modules is unsupported.</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p>
        Bun reached a call to <code>import.meta.glob</code>; Node and Deno reported a TypeScript
        loading restriction first. Vite documents{" "}
        <a href="https://vite.dev/guide/features.html#glob-import">glob imports</a> as a
        Vite-specific feature. This points toward a test-tooling assumption that a plain runtime
        loading check does not supply. It is not enough evidence to call the package’s application
        entry point broken, or to promise that changing runtimes fixes the test entry.
      </p>
      <h2 id="method">How we test Node, Bun and Deno compatibility</h2>
      <p>
        We prepare the published npm artifact with a pinned npm installer, retain its lockfile, then
        mount the same sealed dependency snapshot into each runtime’s sandbox. We disable lifecycle
        scripts during installation and networking during loading. The runtime profiles have bounded
        time, memory and output, with gVisor providing the execution boundary.
      </p>
      <p>
        Each root mode starts in a fresh sandbox. Subpaths run in ordered batches and share that
        batch’s module cache and globals. Reports expose those choices alongside omitted entries,
        failures and exact runtime images. Read the <a href="/methodology">methodology</a> for the
        full scope and limits.
      </p>
      <p>
        Import style deserves its own check. Node’s{" "}
        <a href="https://nodejs.org/api/packages.html#conditional-exports">conditional exports</a>{" "}
        let a package choose different entry files for import and require. A package name and a
        runtime name leave out that part of the experiment. Native binaries, optional peers and
        installation prerequisites can also change the result.
      </p>
      <p>
        Deno npm compatibility also depends on the execution profile. Our Deno checks use an
        existing npm-prepared <code>node_modules</code> tree and <code>-A</code> inside the OS
        sandbox. They do not test Deno’s default permission prompts or compare its installer with
        npm. Consult <a href="https://docs.deno.com/runtime/fundamentals/node/">Deno’s npm guide</a>{" "}
        for the setup your application uses. Bun’s{" "}
        <a href="https://bun.com/docs/runtime/nodejs-compat">Node.js compatibility documentation</a>{" "}
        describes its supported APIs; our reports add observations for an exact package.
      </p>
      <h2 id="your-package">Check the package and import path you use</h2>
      <p>
        If you arrived asking “does this npm package work with Bun?”, start with its exact version
        and loading mode. Search for it on <a href="/">CompatLab</a>, open a completed report or
        request a scan, then inspect the root result and the subpath your application imports. Check
        the omitted coverage before treating an all-green row as a complete answer.
      </p>
      <p>
        Keep the report URL with your migration notes. It identifies a recorded observation, while
        future scans can use different dependencies or runtime images. You can download the report
        JSON and lockfile. Local replay needs the source-built CLI, a qualified Linux/runsc host and
        the exact runtime images; hosted images currently require an operator to supply them. The
        report’s <a href="/methodology#local-cli">replay instructions</a> explain those
        prerequisites.
      </p>
      <p>
        We want examples that expose a useful difference: an entry that loads on one runtime and
        fails on another, a missing peer, or an export our planner should handle better. Share the
        package version, import path and report in the{" "}
        <a href="https://github.com/siddiksawani/CompatLab/issues">project’s issue tracker</a>.
        Include the behavior you expected. That gives us something we can investigate.
      </p>
    </DocumentLayout>
  );
}
