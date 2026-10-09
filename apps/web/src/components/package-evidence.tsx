import type { PackageResponse } from "@compatlab/contracts";
import { labels, observedDate, packageEvidencePath } from "./labels";
import { RequestScan } from "./request-scan";

export function PackageEvidence({ pkg }: { pkg: PackageResponse }) {
  const earlier = pkg.availableReport?.matchesCurrentMatrix === false ? pkg.availableReport : null;
  return (
    <div className="scan-action">
      <p className="eyebrow">
        {pkg.reportId || earlier
          ? "Evidence available"
          : pkg.scanId
            ? "Scan in progress"
            : "Ready to inspect"}
      </p>
      <h2>
        {pkg.reportId
          ? "Open the stored observations."
          : earlier
            ? "A report exists for an earlier environment."
            : "Compare loading across runtimes."}
      </h2>
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
    </div>
  );
}
