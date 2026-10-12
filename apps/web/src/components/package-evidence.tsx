import type { findOtherPackageReports } from "@compatlab/catalog/web";
import type { PackageResponse } from "@compatlab/contracts";
import { labels, observedDate, packageEvidencePath } from "./labels";
import { RequestScan } from "./request-scan";

export function PackageEvidence({
  pkg,
  otherReports = [],
}: {
  pkg: PackageResponse;
  otherReports?: Awaited<ReturnType<typeof findOtherPackageReports>>;
}) {
  const earlier = pkg.availableReport?.matchesCurrentMatrix === false ? pkg.availableReport : null;
  return (
    <div className="scan-action">
      <p className="eyebrow">
        {pkg.reportId || earlier
          ? "Evidence available"
          : pkg.scanId
            ? "Scan in progress"
            : "No report for this version"}
      </p>
      <h2>
        {pkg.reportId
          ? "Open the stored observations."
          : earlier
            ? "A report exists for an earlier environment."
            : pkg.scanId
              ? `A scan is in progress for ${pkg.version}.`
              : `No published report for ${pkg.version} yet.`}
      </h2>
      {!pkg.availableReport && !pkg.reportId && (
        <p>
          {pkg.scanId
            ? "Follow the scan for this exact version while it finishes."
            : "A missing report means this version has no available observations, not that it failed."}
        </p>
      )}
      {earlier && (
        <>
          <p>
            {labels[earlier.outcome]} ·{" "}
            {earlier.coverageComplete ? "Planned coverage complete" : "Coverage limited"}
            <br />
            Observed: {observedDate(earlier.observedAt)}
          </p>
          <p>
            The execution environment has changed since this report. Its recorded runtimes and
            limits still describe the original observations. A new scan uses the current
            environment.
          </p>
          <p>
            <a className="button secondary" href={`/reports/${earlier.id}`}>
              View earlier report
            </a>
          </p>
        </>
      )}
      {pkg.reportId ? (
        <a className="button" href={`/reports/${pkg.reportId}`}>
          View report
        </a>
      ) : !pkg.scanId ? (
        <RequestScan name={pkg.name} version={pkg.version} enabled={pkg.scansEnabled} />
      ) : null}
      {pkg.scanId && (
        <p>
          <a className="button secondary" href={`/scans/${pkg.scanId}`}>
            View scan progress
          </a>
        </p>
      )}
      {pkg.availableReport && (
        <p>
          <a href={packageEvidencePath(pkg.name, pkg.version)}>Version summary</a>
        </p>
      )}
      {otherReports.length > 0 && (
        <section aria-labelledby="other-tested-versions">
          <h3 id="other-tested-versions">Other tested versions</h3>
          <p className="fine">These results do not describe {pkg.version}.</p>
          <ul className="history-list">
            {otherReports.map((report) => (
              <li key={report.id}>
                <a href={`/reports/${report.id}`}>
                  Version {report.version} · {labels[report.outcome]}
                </a>
                <p className="fine">
                  Observed {observedDate(report.observedAt)} ·{" "}
                  {report.coverageComplete ? "Planned coverage complete" : "Coverage limited"}
                  {!report.matchesCurrentMatrix && " · Earlier execution environment"}
                </p>
                <p className="fine">
                  {report.runtimePins.length
                    ? report.runtimePins
                        .map(
                          (runtime) =>
                            `${runtime.kind === "node" ? "Node.js" : runtime.kind === "bun" ? "Bun" : "Deno"} ${runtime.version}`,
                        )
                        .join(" · ")
                    : `Environment: ${report.matrix.revision}`}
                </p>
              </li>
            ))}
          </ul>
          <p className="fine">Opening a report reads saved results. It does not start a scan.</p>
        </section>
      )}
    </div>
  );
}
