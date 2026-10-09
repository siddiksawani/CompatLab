import { notFound } from "next/navigation";
import { FailureDetails } from "../../../components/failure-details";
import { labels, observedDate, packageEvidencePath, packageUrl } from "../../../components/labels";
import { RuntimeMatrix } from "../../../components/runtime-matrix";
import { pageMetadata } from "../../../server/metadata";
import { packageEvidence } from "../../../server/package-evidence";
import { parsePackagePath } from "../../../server/package-path";

type Props = { params: Promise<{ slug: string[] }> };
async function load({ params }: Props) {
  const target = parsePackagePath((await params).slug);
  if (!target) notFound();
  const evidence = await packageEvidence(target.name, target.version);
  if (!evidence) notFound();
  return evidence;
}

function runtimeSummary(summary: Awaited<ReturnType<typeof load>>["summary"]) {
  return summary.matrix.images
    .map((image) => {
      const runtime = summary.runtimes.find((runtime) => runtime.profileId === image.profileId);
      const name = image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno";
      return `${name} ${image.version}: ${labels[runtime?.outcome ?? "inconclusive"].toLowerCase()}`;
    })
    .join("; ");
}

export async function generateMetadata(props: Props) {
  const { summary } = await load(props);
  return pageMetadata(
    `${summary.artifact.name}@${summary.artifact.version} — Node.js, Bun and Deno loading results`,
    `${runtimeSummary(summary)}. ${summary.coverageComplete ? "Planned checks completed." : "Coverage is limited."} Loading does not prove functional correctness.`,
    packageEvidencePath(summary.artifact.name, summary.artifact.version),
  );
}

export default async function PackageEvidencePage(props: Props) {
  const { summary, available } = await load(props);
  const { name, version } = summary.artifact;
  const reportPath = `/reports/${summary.id}`;
  return (
    <section className="page report">
      <a className="back" href={packageUrl(name, version)}>
        Choose a version or request a scan
      </a>
      <h1 className="package-title">
        {name}
        <span className="version">{version}</span>
      </h1>
      <p className="lede">
        Does {name} {version} load in Node.js, Bun and Deno? In the recorded environment, the
        results were {runtimeSummary(summary)}.{" "}
        {summary.coverageComplete
          ? "All applicable planned checks completed."
          : "Some planned checks are missing or incomplete."}{" "}
        Loading success does not establish functional correctness or package safety.
      </p>
      <p className="muted">Observed {observedDate(summary.observedAt)} · Linux amd64 / glibc</p>
      {!available.matchesCurrentMatrix && (
        <aside className="notice warning">
          <strong>Earlier execution environment</strong>
          <p>
            The service now uses a different environment. These results describe only the runtime
            versions and images shown here.
          </p>
        </aside>
      )}
      <section className="report-section">
        <h2>Loading results</h2>
        <RuntimeMatrix report={summary} reportId={summary.id} />
        <p className="fine">
          Import uses ESM; require uses CommonJS. Results cover the package root and selected
          explicit subpaths. Select a result to inspect its evidence.
        </p>
      </section>
      {summary.preparation.failure && (
        <section className="report-section">
          <h2>Preparation did not complete</h2>
          <FailureDetails failure={summary.preparation.failure} />
        </section>
      )}
      {!!summary.missingOptionalPeers.length && (
        <aside className="notice warning">
          <h2>Missing optional peers</h2>
          <p>
            Some checks could not load without optional peers absent from the snapshot. Their
            compatibility is inconclusive; installing a peer needs a separate test.
          </p>
          <ul>
            {summary.missingOptionalPeers.map((peer) => (
              <li key={`${peer.name}@${peer.range}`}>
                <code>{peer.name}</code> {peer.range}
              </li>
            ))}
          </ul>
          {summary.missingOptionalPeersTruncated && (
            <p>
              This list is limited to 16 requirements. The full report retains the remaining
              evidence.
            </p>
          )}
        </aside>
      )}
      <section className="report-section">
        <h2>Source evidence and limitations</h2>
        <p>
          This page selects an eligible observation for this exact version, preferring the current
          environment. The selection can change after a rescan or reclassification. Cite the
          observation link below when referring to these results.
        </p>
        <div className="actions">
          <a className="button" href={reportPath}>
            Full report and provenance
          </a>
          <a href={`/api/v1/reports/${summary.id}/summary`}>Compact JSON</a>
          <a href={`/history?${new URLSearchParams({ name })}`}>Report history</a>
        </div>
        <p className="fine">
          Matrix {summary.matrix.revision} · Classifier {summary.classifierRevision} · Install
          scripts disabled
        </p>
        <ul>
          {summary.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <a href="/methodology">How the tests work</a>
      </section>
    </section>
  );
}
