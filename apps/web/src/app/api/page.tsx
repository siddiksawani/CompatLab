import { DocumentLayout } from "../../components/section-navigation";
import { pageMetadata } from "../../server/metadata";

export const metadata = pageMetadata(
  "Public API",
  "Read npm metadata and stored runtime reports through CompatLab's anonymous public API. No API key is required.",
  "/api",
);

export default function ApiGuide() {
  return (
    <DocumentLayout
      sections={[
        { id: "read", label: "Read reports" },
        { id: "status", label: "Interpret results" },
        { id: "markdown", label: "Markdown" },
        { id: "mcp", label: "MCP tools" },
        { id: "access", label: "Access and limits" },
      ]}
    >
      <h1>Public API</h1>
      <p className="lede">
        Find a package and read its stored loading results. These requests need no account or API
        key and never start scans.
      </p>
      <p>
        <a href="/openapi.json">OpenAPI specification</a> ·{" "}
        <a href="/.well-known/api-catalog">API catalog</a>
        {" · "}
        <a href="/llms.txt">Agent reading guide</a>
      </p>
      <h2 id="read">Find existing evidence</h2>
      <ol>
        <li>
          Search with <code>GET /api/v1/search?q=express</code>.
        </li>
        <li>
          Read <code>GET /api/v1/packages?name=express</code> to resolve the latest version, or
          supply an exact <code>version</code>. Tags such as <code>latest</code> and version ranges
          are not accepted in that parameter.
        </li>
        <li>
          If <code>reportId</code> is present, fetch <code>GET /api/v1/reports/&#123;id&#125;</code>
          . If only <code>scanId</code> is present, check{" "}
          <code>GET /api/v1/scans/&#123;id&#125;</code> for progress. A missing report is not a
          failure verdict.
        </li>
        <li>
          Check <code>availableReport</code> for retained evidence when <code>reportId</code> is
          null. When <code>matchesCurrentMatrix</code> is false, that report uses another approved
          execution environment. Cite its recorded runtime pins and observation date; it does not
          describe the current environment. An active scan and an existing report can both be
          present.
        </li>
      </ol>
      <p>
        URL-encode query parameters for scoped names. Version lists contain at most 200 entries;{" "}
        <code>versionsTruncated</code> tells you when there are more. An exact older version can
        still be requested.
      </p>
      <p>
        Exact-version evidence also has readable pages such as <code>/npm/express/5.2.1</code> and{" "}
        <code>/npm/@scope/name/1.0.0</code>. These pages read retained catalog evidence without
        contacting npm. They can select a different observation after a rescan; cite the linked
        <code> /reports/&#123;id&#125;</code> URL for the result you used. No eligible report means
        HTTP 404, not a failure verdict.
      </p>
      <p>
        For compact JSON, use <code>GET /api/v1/reports/&#123;id&#125;/summary</code>. It keeps
        status, exact artifact and runtime pins, preparation, per-runtime outcomes, per-group
        coverage and representative failures. <code>reportPath</code> is the observation link
        relative to this site. Optional peer requirements are deduplicated and limited to 16;{" "}
        <code>missingOptionalPeersTruncated</code> identifies a longer list. Individual entries,
        omitted subpaths, raw logs and named assertions remain in the full report. A group’s first
        failure does not describe every failure in that group.
      </p>
      <h2 id="status">Keep outcome, coverage and status separate</h2>
      <p>
        Read <code>status.current</code> before citing evidence. Historical reports remain readable
        and may link to a replacement. Include the package version, observation time, runtime pins
        and report URL in your answer.
      </p>
      <p>
        Here, <code>status.current</code> means the report is not invalidated, replaced or blocked
        by service policy. It does not mean the package version is latest or the report uses the
        current execution environment. Package lookup exposes that distinction through{" "}
        <code>availableReport.matchesCurrentMatrix</code>.
      </p>
      <p>
        Each cell has an outcome and separate passed, failed, interrupted and untested counts.
        Complete coverage means the planned checks ran; it does not mean they all passed. Loading
        success does not prove functional correctness or safety.{" "}
        <a href="/methodology">Read the methodology and limitations.</a>
      </p>
      <h2 id="markdown">Request a Markdown summary</h2>
      <p>
        Send <code>Accept: text/markdown</code> when requesting the homepage or a report page. HTML
        remains the default for browsers. Explicit alternatives are{" "}
        <a href="/index.md">/index.md</a> and <code>/reports/&#123;id&#125;/markdown</code>.
      </p>
      <p>
        Report summaries include status, loading results, coverage and provenance. Use the linked
        JSON or full report for individual entries, named assertions, logs and reproduction inputs.
        Markdown is currently available for the homepage and report pages.
      </p>
      <h2 id="mcp">Connect an MCP client</h2>
      <p>
        Add <code>https://compatlab.me/mcp</code> as a remote MCP server using Streamable HTTP. No
        account, API key or local package installation is required. The endpoint supports the
        2026-07-28 protocol and stateless 2025 clients.
      </p>
      <ul>
        <li>
          <code>check_package</code> accepts an exact npm <code>name</code> and optional exact
          <code> version</code>. Omitting the version resolves the current npm latest tag. It
          returns existing evidence, including an eligible earlier environment when available.
        </li>
        <li>
          <code>get_report</code> accepts a report UUID as <code>id</code> and returns its compact
          evidence and current eligibility.
        </li>
      </ul>
      <p>
        Both tools return <code>reportUrl</code>, <code>matchesCurrentMatrix</code> and the same
        compact report contract described above. Missing evidence has <code>kind: missing</code>; it
        is not a failed compatibility test. Tools cannot submit scans, install packages or access
        maintainer accounts. Selected-package lookups contribute to the disclosed aggregate counts
        in our <a href="/privacy">privacy policy</a>.
      </p>
      <p>
        Calls have bounded concurrency and a 12-second read deadline. Retry temporary tool errors
        with backoff. Use native remote-server support in your client; cross-origin browser calls
        and persistent subscription streams are not enabled. Client setup and validation commands
        are in the{" "}
        <a href="https://github.com/siddiksawani/CompatLab/blob/main/docs/mcp.md">MCP guide</a>.
      </p>
      <h2 id="access">Access and limits</h2>
      <p>
        The public read API and MCP tools are anonymous. CompatLab does not provide agent
        registration, OAuth, A2A or payment endpoints. Maintainer tools are coming later.
      </p>
      <p>
        Respect <code>Retry-After</code> when supplied and use bounded retries with backoff for HTTP
        429 or 503. Revalidate stored report status before presenting it as current. Report and scan
        reads also support HEAD and conditional requests with ETags.
      </p>
      <p>
        To request new work, use the package page and its explicit scan action. Admission checks,
        capacity limits and worker availability still apply. Do not automatically submit scans while
        browsing or indexing reports.
      </p>
      <p>
        Our <a href="/robots.txt">content signals</a> allow search indexing and use in answers,
        while declining model training. They express preferences, not access controls.{" "}
        <a href="/privacy#removal">Request a correction or removal.</a>
      </p>
    </DocumentLayout>
  );
}
