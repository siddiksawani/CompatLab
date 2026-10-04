import { type HostedReport, type ReportCell, reportEnvelopeSchema } from "@compatlab/contracts";
import { displayIdentifier } from "@compatlab/engine";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Copy } from "../../../components/copy";
import { Evidence } from "../../../components/evidence";
import { labels, observedDate, packageUrl } from "../../../components/labels";
import { publicRead, webRuntime } from "../../../server/runtime";

const loadReport = cache(async (id: string) => {
  const response = await publicRead(`/api/v1/reports/${encodeURIComponent(id)}`);
  if ([400, 404].includes(response.status)) notFound();
  if (!response.ok) throw new Error("Report unavailable.");
  return reportEnvelopeSchema.parse(await response.json());
});
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { report } = await loadReport((await params).id);
  return {
    title: `${report.artifact.name}@${report.artifact.version}`,
    description: `${labels[report.outcome]} loading observations across ${report.matrix.images.length} pinned runtimes. ${report.coverageComplete ? "Planned coverage complete." : "Coverage has limits."}`,
    robots: { index: false, follow: true },
  };
}
function Result({ cell }: { cell: ReportCell | undefined }) {
  return cell ? (
    <a className={`result ${cell.outcome}`} href={`#${cell.profileId}-${cell.group}-${cell.mode}`}>
      {labels[cell.outcome]}
      {cell.group === "subpaths" && (
        <small>
          {cell.coverage.observed}/{cell.coverage.planned ?? "?"} observed
        </small>
      )}
    </a>
  ) : (
    <span>Unavailable</span>
  );
}
const groups = [
  ["root", "esm"],
  ["root", "commonjs"],
  ["subpaths", "esm"],
  ["subpaths", "commonjs"],
] as const;
const columnNames = ["Root import", "Root require", "Subpath imports", "Subpath requires"];
function Matrix({ report }: { report: HostedReport }) {
  return (
    <>
      <div className="desktop-matrix">
        <table>
          <caption className="sr-only">Loading outcomes by runtime and consumer mode</caption>
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              {columnNames.map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.matrix.images.map((image) => (
              <tr key={image.profileId}>
                <th scope="row">
                  <strong>
                    {image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno"}
                  </strong>
                  <span className="runtime-version mono">{image.version}</span>
                </th>
                {groups.map(([group, mode]) => (
                  <td key={`${group}-${mode}`}>
                    <Result
                      cell={report.cells.find(
                        (cell) =>
                          cell.profileId === image.profileId &&
                          cell.group === group &&
                          cell.mode === mode,
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-matrix">
        {report.matrix.images.map((image) => (
          <article key={image.profileId}>
            <h3>
              {image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno"}{" "}
              <span className="runtime-version mono">{image.version}</span>
            </h3>
            {groups.map(([group, mode], index) => (
              <div className="row" key={`${group}-${mode}`}>
                <span>{columnNames[index]}</span>
                <Result
                  cell={report.cells.find(
                    (cell) =>
                      cell.profileId === image.profileId &&
                      cell.group === group &&
                      cell.mode === mode,
                  )}
                />
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { report, status } = await loadReport((await params).id);
  const base = `/api/v1/reports/${report.id}`;
  const command = `compatlab reproduce ./${report.id}-reproduction.json --rebuild --lockfile ./package-lock.json --json`;
  const runtimeLabels = new Map(
    report.matrix.images.map((image) => [
      image.profileId,
      `${image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno"} ${image.version}`,
    ]),
  );
  const staticJson = JSON.stringify(report.preparation.staticObservations, null, 2);
  return (
    <section className="page report">
      <a className="back" href={packageUrl(report.artifact.name, report.artifact.version)}>
        ← Package details
      </a>
      <div className="report-title">
        <div>
          <p className="eyebrow">Runtime evidence / {report.evidenceLevel.replaceAll("_", " ")}</p>
          <h1 className="package-title">
            {report.artifact.name}
            <span className="version">{report.artifact.version}</span>
          </h1>
          <p className="muted">Observed {observedDate(report.observedAt)} · Linux amd64 / glibc</p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`${base}/json`}>
            Download JSON
          </a>
          <Copy
            label="Copy report link"
            value={`${webRuntime().config.origin}/reports/${report.id}`}
          />
        </div>
      </div>
      {!status.current && (
        <aside className="notice warning">
          <strong>Historical evidence</strong>
          <p>
            {status.invalidationReason ||
              (!status.policyAllowed
                ? "This artifact or runtime profile is unavailable under the current policy."
                : "A newer classification has replaced this report.")}
          </p>
          {status.replacedBy && (
            <a href={`/reports/${status.replacedBy}`}>Open the replacement report →</a>
          )}
        </aside>
      )}
      <p>
        Observation {status.observationRevision ?? 0} ·{" "}
        <a href={`/history?${new URLSearchParams({ name: report.artifact.name })}`}>
          Report history
        </a>{" "}
        · <a href={`/account?rescan=${report.scanId}`}>Request a maintainer rescan</a>
      </p>
      {status.previousReportId && (
        <p>
          <a href={`/compare?before=${status.previousReportId}&after=${report.id}`}>
            Compare with the previous observation
          </a>
        </p>
      )}
      <p>
        <a href={`${webRuntime().config.origin}/reports/${report.id}`}>
          <Image
            unoptimized
            width={600}
            height={28}
            className="evidence-badge"
            src={`/api/v1/badges/${report.id}.svg`}
            alt={`Immutable loading evidence badge for ${report.artifact.name}`}
          />
        </a>
      </p>
      <Copy
        label="Copy evidence badge Markdown"
        value={`[![CompatLab loading evidence](${webRuntime().config.origin}/api/v1/badges/${report.id}.svg)](${webRuntime().config.origin}/reports/${report.id})`}
      />
      <div className="report-summary">
        <div>
          <span className={`result ${report.outcome}`}>{labels[report.outcome]}</span>
          <p>
            {report.coverageComplete
              ? "All applicable planned loading observations completed."
              : "Coverage is limited. Inspect the groups and omissions below."}
          </p>
        </div>
        <p className="fine">
          This is loading evidence. It does not establish functional correctness or package safety.
        </p>
      </div>
      <section className="report-section">
        <div className="section-heading">
          <h2>Runtime matrix</h2>
          <span className="fine">
            {report.matrix.images.length} pinned runtimes · {report.matrix.revision}
          </span>
        </div>
        <Matrix report={report} />
        <p className="fine">
          Import uses ESM; require uses CommonJS. Root modes use fresh sandboxes. Subpath batches
          share module caches and globals. Select a result to inspect its evidence.
        </p>
      </section>
      <section className="report-section">
        <h2>Shared preparation</h2>
        <div className="preparation-summary">
          <span className={`result ${report.preparation.outcome}`}>
            {labels[report.preparation.outcome]}
          </span>
          <p>
            {report.preparation.installedCount} installed packages ·{" "}
            {report.preparation.omittedOptionalCount} optional dependencies omitted · lifecycle
            scripts disabled
          </p>
        </div>
        {report.preparation.failure && (
          <p className="failure-text">
            <code>{report.preparation.failure.classification}</code> ·{" "}
            {report.preparation.failure.phase.replaceAll("_", " ")}
            <br />
            {report.preparation.failure.message}
          </p>
        )}
        <details>
          <summary>Static manifest, native and script observations</summary>
          <p className="fine">
            Static indicators are context; their presence alone does not establish a prerequisite or
            failure.
          </p>
          <textarea
            className="log-text"
            aria-label="Static observations"
            readOnly
            rows={12}
            value={staticJson.slice(0, 8192)}
          />
          {staticJson.length > 8192 && (
            <p>Preview truncated. Download JSON for all retained observations.</p>
          )}
        </details>
      </section>
      <section className="report-section">
        <h2>Coverage and evidence</h2>
        {report.cells.map((cell) => (
          <details
            className="cell-details"
            id={`${cell.profileId}-${cell.group}-${cell.mode}`}
            key={`${cell.profileId}-${cell.group}-${cell.mode}`}
          >
            <summary>
              <span>
                {runtimeLabels.get(cell.profileId) ?? cell.profileId} ·{" "}
                {cell.group === "root" ? "Root" : "Subpaths"} ·{" "}
                {cell.mode === "esm" ? "ESM import" : "CommonJS require"}
              </span>
              <span className={`result ${cell.outcome}`}>{labels[cell.outcome]}</span>
            </summary>
            <div className="detail-content">
              <p>
                {cell.coverage.passed} passed · {cell.coverage.failed} failed ·{" "}
                {cell.coverage.interrupted} interrupted · {cell.coverage.untested ?? "unknown"}{" "}
                untested of {cell.coverage.planned ?? "unknown"} planned
              </p>
              {cell.failure && (
                <p className="failure-text">
                  <code>{cell.failure.classification}</code> ·{" "}
                  {cell.failure.phase.replaceAll("_", " ")}
                  <br />
                  {cell.failure.message}
                </p>
              )}
              {cell.runId ? (
                <Evidence reportId={report.id} runId={cell.runId} />
              ) : (
                <p>No runtime observation was recorded for this group.</p>
              )}
            </div>
          </details>
        ))}
        {report.omissions && (
          <details className="omissions">
            <summary>Planner omissions</summary>
            <dl className="counts">
              {Object.entries(report.omissions.counts).map(([reason, count]) => (
                <div key={reason}>
                  <dt>{reason.replaceAll("_", " ")}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <ul>
              {report.omissions.samples.map((entry) => (
                <li key={`${entry.subpath}-${entry.reason}`}>
                  <code>{displayIdentifier(entry.subpath)}</code> —{" "}
                  {entry.reason.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {!!report.assertions?.length && (
        <section className="report-section" aria-label="Named assertion results">
          <h2>Named assertion results</h2>
          <p>
            These observations test only the stated behavior. Their outcomes are separate from
            automatic loading above. A failure may originate in the probe or package.
          </p>
          {report.assertions.map(({ definition, cells }) => (
            <div key={definition.digest}>
              <h3>{definition.manifest.name}</h3>
              <p>{definition.manifest.expectedBehavior}</p>
              <p>
                <a href={`https://github.com/${definition.repository}/commit/${definition.commit}`}>
                  Pinned source
                </a>{" "}
                · <code>{definition.digest}</code>
              </p>
              <p>
                Approved capabilities: no network; read-only package and fixture workspace; bounded
                temporary/output storage and processes. Timeout: {definition.manifest.timeoutMs} ms.
                Harness: {definition.harnessRevision}; policy: {definition.policyRevision}.
              </p>
              <ul>
                {cells.map((cell) => (
                  <li key={cell.profileId}>
                    <strong>
                      {cell.profileId}: {labels[cell.outcome]}
                    </strong>{" "}
                    · {cell.evidenceLevel.replaceAll("_", " ")}
                    {cell.failure && (
                      <p>
                        <code>{cell.failure.classification}</code>: {cell.failure.message}
                      </p>
                    )}
                    {cell.runId && (
                      <p>
                        <a href={`${base}/evidence?runId=${cell.runId}`}>Assertion evidence JSON</a>{" "}
                        · <a href={`${base}/logs?runId=${cell.runId}`}>Retained logs</a>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      <section className="report-section" id="reproduction">
        <h2>Reproduce these inputs</h2>
        {report.preparation.snapshot ? (
          <>
            <p>
              Download both files, then run on a qualified Linux amd64/runsc host with the pinned
              images available. Rebuilding creates a new snapshot generation.
            </p>
            <div className="actions">
              <a href={`${base}/reproduction`}>Reproduction inputs</a>
              <a href={`${base}/lock`}>Exact package lock</a>
              <Copy value={command} label="Copy reproduction command" />
            </div>
            <pre>
              <code>{command}</code>
            </pre>
            <p className="fine">
              {status.snapshotAvailable
                ? "The original worker last reported its sealed snapshot as available. Verified reuse requires those actual bytes in your local state directory."
                : "The recorded worker snapshot is unavailable. Retained identity and lock bytes do not guarantee a successful rebuild."}{" "}
              <a href="/methodology#local-cli">Setup and replay limits</a>
            </p>
          </>
        ) : (
          <p>
            No sealed snapshot was produced. A runtime reproduction is unavailable; inspect the
            preparation failure above.
          </p>
        )}
        <details>
          <summary>Exact provenance</summary>
          <dl className="provenance">
            {Object.entries({
              artifact: `${report.artifact.name}@${report.artifact.version}`,
              integrity: report.artifact.integrity,
              tarball: report.artifact.tarballUrl,
              snapshot: report.preparation.snapshot?.id ?? "Unavailable",
              generation: report.preparation.snapshot?.generation ?? "Unavailable",
              lockDigest: report.preparation.snapshot?.lockDigest ?? "Unavailable",
              treeDigest: report.preparation.snapshot?.treeDigest ?? "Unavailable",
              installerImage: report.preparation.snapshot?.installerImage ?? "Unavailable",
              preparationProfile: report.preparation.profileRevision,
              harness: report.matrix.harnessRevision,
              planner: report.matrix.planRevision,
              policy: report.matrix.policyRevision,
              classifier: report.classifierRevision,
              classifiedAt: report.classifiedAt,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>
          {report.matrix.images.map((image) => (
            <div key={image.profileId} className="image-identity">
              <h4>{image.profileId}</h4>
              <p className="mono break">{image.imageId}</p>
              <p className="fine">
                Built {observedDate(image.builtAt)} · {image.recipeRevision}
              </p>
            </div>
          ))}
        </details>
      </section>
      <section className="report-section limitations">
        <h2>Evidence limitations</h2>
        <ul>
          {report.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
