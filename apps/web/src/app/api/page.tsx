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
      </ol>
      <p>
        URL-encode query parameters for scoped names. Version lists contain at most 200 entries;{" "}
        <code>versionsTruncated</code> tells you when there are more. An exact older version can
        still be requested.
      </p>
      <h2 id="status">Keep outcome, coverage and status separate</h2>
      <p>
        Read <code>status.current</code> before citing evidence. Historical reports remain readable
        and may link to a replacement. Include the package version, observation time, runtime pins
        and report URL in your answer.
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
      <h2 id="access">Access and limits</h2>
      <p>
        The public read API is anonymous. CompatLab does not provide agent registration, OAuth, MCP,
        A2A or payment endpoints. Maintainer tools are coming later.
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
