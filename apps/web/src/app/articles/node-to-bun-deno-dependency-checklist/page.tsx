import type { Metadata } from "next";
import { headers } from "next/headers";
import { Breadcrumbs } from "../../../components/breadcrumbs";
import { packageEvidencePath } from "../../../components/labels";
import { DocumentLayout } from "../../../components/section-navigation";
import { migrationArticle as article, articleDate } from "../../../content/articles";
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

const examples = {
  axios: { name: "axios", version: "1.20.0", report: "fe0e3165-daa8-456f-8225-61c433188897" },
  zod: { name: "zod", version: "4.6.7", report: "7c58aabb-1680-4cb2-bfcd-ce49187602ba" },
  sharp: { name: "sharp", version: "0.35.5", report: "b1f68888-ab5f-42bc-b195-18928f566c0f" },
  grpc: {
    name: "@grpc/grpc-js",
    version: "1.14.6",
    report: "7482b01c-3445-4e37-b351-5a947f8dae71",
  },
};

function EvidenceLinks({ name, version, report }: (typeof examples)[keyof typeof examples]) {
  return (
    <p>
      <a href={packageEvidencePath(name, version)}>
        {name}@{version} version evidence
      </a>
      {" · "}
      <a href={`/reports/${report}`}>
        Original loading report for {name}@{version}
      </a>
    </p>
  );
}

export default async function MigrationArticle() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = publicOrigin();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    inLanguage: "en",
    author: {
      "@type": "Organization",
      name: article.author,
      url: "https://github.com/siddiksawani/CompatLab",
    },
    publisher: { "@type": "Organization", name: "CompatLab", url: origin },
    mainEntityOfPage: origin + article.path,
    citation: Object.values(examples).map(({ report }) => `${origin}/reports/${report}`),
  };

  return (
    <DocumentLayout
      sections={[
        { id: "lockfile", label: "Start with your lockfile" },
        { id: "axios", label: "Axios and HTTP requests" },
        { id: "zod", label: "Zod and subpath imports" },
        { id: "sharp", label: "Sharp and native dependencies" },
        { id: "grpc", label: "gRPC clients" },
        { id: "checklist", label: "Before you switch" },
      ]}
    >
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(structuredData).replaceAll("<", "\\u003c")}
      </script>
      <header className="article-header">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Articles", path: "/articles" },
            { name: "Dependency checklist", path: article.path },
          ]}
        />
        <h1>{article.title}</h1>
        <p className="muted">
          By {article.author} ·{" "}
          <time dateTime={article.publishedAt}>{articleDate(article.publishedAt)}</time>
        </p>
        <p className="lede">
          Before moving a Node.js app to Bun or Deno, check the exact npm versions and import paths
          in your project. A passing import gets you to the next test. For an HTTP client that means
          making a request, and for an image library it means processing an image on your deployment
          platform.
        </p>
      </header>

      <h2 id="lockfile">Start with the dependency your app actually loads</h2>
      <ol>
        <li>Read the resolved version from your lockfile, including the workspace that uses it.</li>
        <li>
          Copy the actual specifier and mode from your code, such as{" "}
          <code>import "zod/v4/core"</code> or <code>require("axios")</code>. The package root and
          its subpaths can resolve differently.{" "}
          <a href="https://nodejs.org/api/packages.html#subpath-exports">Node.js export rules</a>
        </li>
        <li>
          <a href="/npm/compatibility">Find recorded npm loading results</a> and open the cell for
          your target runtime and import mode. Check its runtime version, observation date and
          coverage.
        </li>
        <li>
          Run one application test that exercises the dependency in the target environment. Compare
          the response or error with the same test on your existing Node.js deployment.
        </li>
      </ol>
      <p>
        The four observations below use Node.js 24.21.0 and 26.10.0, Bun 1.4.2 and Deno 2.9.7 on
        Linux amd64 with glibc. Each report pins its own dependency snapshot. Install scripts and
        probe networking were disabled, and the probes loaded entries without calling exports. The
        follow-up tests below are instructions for your application.
      </p>

      <h2 id="axios">Axios 1.20.0 on Bun or Deno</h2>
      <p>
        The package root loaded with ESM and CommonJS on all four runtime profiles on October 9. The
        observed subpaths passed too, including <code>axios/dist/node/axios.cjs</code>. The report
        is inconclusive overall because the planner did not enumerate <code>./unsafe/*</code>. If
        your code imports another internal path, check that exact specifier in the report.
      </p>
      <p>
        <strong>Next test.</strong> Send a request to a local fixture server using your app’s
        configured adapter. Assert the status and decoded response, then force a slow response and
        verify the timeout handling. Include redirects or streaming only if your app uses them. See
        the <a href="https://axios-http.com/docs/req_config">Axios request options</a>.
      </p>
      <EvidenceLinks {...examples.axios} />

      <h2 id="zod">Zod 4.6.7 and explicit subpaths</h2>
      <p>
        On November 10 the root and tested subpaths loaded in both modes on all four profiles. Those
        subpaths included <code>zod/v4/core</code> and <code>zod/v4/mini</code>. The wildcard
        <code> ./v4/locales/*</code> was omitted. A pass for <code>zod/v4/locales</code> leaves an
        individual locale import unverified unless that path has its own observation.
      </p>
      <p>
        <strong>Next test.</strong> Run the exact schema your app uses with one valid and one
        invalid input. Compare the output of transforms and the validation issues your error handler
        consumes. If you use Mini or a locale, keep that import in the test. See{" "}
        <a href="https://zod.dev/basics">Zod’s parsing guide</a>.
      </p>
      <EvidenceLinks {...examples.zod} />

      <h2 id="sharp">Sharp 0.35.5 and native dependencies</h2>
      <p>
        The root loaded in both modes on all four profiles on October 9. The report covers the Linux
        glibc snapshot used for that observation. A deployment that uses musl, arm64 or a different
        optional-dependency selection can load a different native binary.
      </p>
      <p>
        <strong>Next test.</strong> Install with your deployment’s lockfile on its actual
        architecture and libc. Resize a small fixture using the image formats and options your app
        relies on. Assert the output format and dimensions. Check{" "}
        <a href="https://sharp.pixelplumbing.com/install/">
          Sharp’s platform and optional-dependency requirements
        </a>
        .
      </p>
      <EvidenceLinks {...examples.sharp} />

      <h2 id="grpc">gRPC clients with @grpc/grpc-js 1.14.6</h2>
      <p>
        The root loaded in both modes on all four profiles on October 9. The report stops at
        loading. It contains no client-to-server calls.
      </p>
      <p>
        <strong>Next test.</strong> Call a local test service with your generated client. Check a
        successful response and the status you get when a deadline expires. If production uses TLS,
        metadata or streaming, cover the same path in your integration environment.
      </p>
      <EvidenceLinks {...examples.grpc} />

      <h2 id="checklist">What to record before you switch</h2>
      <ul>
        <li>The exact version, import path and mode for each dependency on a critical path.</li>
        <li>The target runtime version, OS, architecture and installation prerequisites.</li>
        <li>One application test per critical dependency and what it proved on each runtime.</li>
        <li>Untested paths and operations that still need coverage before the migration.</li>
      </ul>
      <p>
        Use the <a href="https://bun.com/docs/runtime/nodejs-compat">Bun Node.js API notes</a> or{" "}
        <a href="https://docs.deno.com/runtime/fundamentals/node/">Deno’s Node and npm guide</a>{" "}
        when a test depends on a Node.js API. For a lockfile review in a coding agent, see{" "}
        <a href="/articles/mcp-npm-compatibility-ai-agents">the read-only MCP guide</a>.
      </p>
      <p>
        <a href="/">Look up another npm dependency</a>
        {" · "}
        <a href="/methodology">Read the loading test methodology</a>
      </p>
    </DocumentLayout>
  );
}
