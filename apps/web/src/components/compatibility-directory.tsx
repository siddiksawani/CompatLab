import { combineOutcomes } from "@compatlab/engine";
import { loadingCounts, runtimeNames } from "../server/compatibility-copy";
import {
  directoryPath,
  directoryTitle,
  type loadDirectory,
} from "../server/compatibility-directory";
import { Breadcrumbs } from "./breadcrumbs";
import { labels, observedDate, packageEvidencePath } from "./labels";

export function CompatibilityDirectory({
  page,
  failures = false,
}: {
  page: Awaited<ReturnType<typeof loadDirectory>>;
  failures?: boolean;
}) {
  const path = directoryPath(failures);
  const nextQuery = new URLSearchParams({
    ...(page.runtime ? { runtime: page.runtime } : {}),
    ...(page.next ? { after: page.next } : {}),
  });
  return (
    <section className="page report">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "npm compatibility", path: directoryPath(false) },
          ...(failures ? [{ name: "Loading failures", path }] : []),
          ...(page.after ? [{ name: "More results", path: page.path }] : []),
        ]}
      />
      <h1>{directoryTitle(failures)}</h1>
      <p className="lede">
        {failures
          ? "These exact npm package versions had at least one recorded loading failure. Compare Node.js, Bun and Deno, then open the original report to inspect the failing import or require."
          : "Compare how tested npm packages load in Node.js, Bun and Deno. Each result names an exact package version, the tested runtimes and a report you can inspect or reproduce."}
      </p>
      <p>
        {failures
          ? "A failure here does not prove a runtime bug: the same package may fail in several environments. Missing optional peers, installation prerequisites, timeouts and service errors alone do not qualify a report for this list."
          : "Node.js support does not establish Bun or Deno npm compatibility. Compare ESM import, CommonJS require and explicit subpaths using the same installed dependencies. A runtime may pass its observed checks while overall coverage remains limited."}
      </p>
      <p>
        These are loading tests on Linux amd64 / glibc, with install scripts and execution
        networking disabled. Passing does not prove functional correctness. Versions listed here are
        tested versions, not necessarily the latest releases. Reports prefer the current environment
        and fall back to eligible earlier observations.
      </p>
      <div className="actions">
        <a href={directoryPath(!failures)}>
          {failures
            ? "All package compatibility results"
            : "Which npm packages had loading failures?"}
        </a>
        <a href="/methodology">Test methodology and limits</a>
        <a href="/api">API and MCP access</a>
      </div>
      {failures && (
        <nav className="actions" aria-label="Filter failures by runtime">
          <a href={path} aria-current={!page.runtime ? "page" : undefined}>
            All runtimes
          </a>
          {(["node", "bun", "deno"] as const).map((kind) => (
            <a
              key={kind}
              href={`${path}?runtime=${kind}`}
              aria-current={page.runtime === kind ? "page" : undefined}
            >
              {runtimeNames[kind]}
            </a>
          ))}
        </nav>
      )}
      {page.runtime && (
        <p>Showing packages with recorded failures in {runtimeNames[page.runtime]}.</p>
      )}
      <section className="report-section" aria-label="Tested npm packages">
        <h2>{failures ? "Recorded failures" : "Tested npm packages"}</h2>
        {!page.entries.length && (
          <p>
            {failures
              ? "No eligible reports currently contain a qualifying loading failure for this selection. This does not establish that all npm packages work in these runtimes."
              : "No eligible reports are available yet. Search for a package to check its availability."}
          </p>
        )}
        <ul className="compatibility-list">
          {page.entries.map(({ artifactId, matchesCurrentMatrix, report }) => (
            <li key={artifactId}>
              <h3>
                <a href={packageEvidencePath(report.artifact.name, report.artifact.version)}>
                  {report.artifact.name}@{report.artifact.version}
                </a>
              </h3>
              <p>
                <span className={`result ${report.outcome}`}>{labels[report.outcome]}</span>{" "}
                {report.coverageComplete ? "Planned coverage complete" : "Coverage limited"}
              </p>
              <ul className="runtime-outcomes">
                {report.matrix.images.map((image) => {
                  const cells = report.cells.filter((cell) => cell.profileId === image.profileId);
                  const outcome = combineOutcomes(cells.map((cell) => cell.outcome));
                  return (
                    <li key={image.profileId}>
                      {runtimeNames[image.kind]} {image.version}: <strong>{labels[outcome]}</strong>
                      <span className="fine"> · {loadingCounts(cells)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="fine">
                Observed {observedDate(report.observedAt)}
                {!matchesCurrentMatrix && " · Earlier execution environment"}
              </p>
              <a href={`/reports/${report.id}`}>
                Full loading report for {report.artifact.name}@{report.artifact.version}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <nav className="actions" aria-label="Result pages">
        {page.after && (
          <a href={path + (page.runtime ? `?runtime=${page.runtime}` : "")}>First results</a>
        )}
        {page.next && <a href={`${path}?${nextQuery}`}>Next results</a>}
      </nav>
    </section>
  );
}
