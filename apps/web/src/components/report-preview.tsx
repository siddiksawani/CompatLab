import type { ReportPreview } from "@compatlab/catalog/web";
import { labels, observedDate } from "./labels";
import { RuntimeMatrix } from "./runtime-matrix";

export function ReportPreviewCard({ report }: { report: ReportPreview }) {
  return (
    <section className="report-preview" aria-labelledby="preview-title">
      <div className="preview-heading">
        <div>
          <p className="fine">Example loading report</p>
          <h2 id="preview-title">
            <a className="preview-title" href={`/reports/${report.id}`}>
              {report.artifact.name}
              <span className="version">{report.artifact.version}</span>
            </a>
          </h2>
        </div>
        <span className={`result ${report.outcome}`}>{labels[report.outcome]}</span>
      </div>
      <RuntimeMatrix report={report} reportId={report.id} rootOnly />
      <p className="fine">Linux amd64 / glibc · Observed {observedDate(report.observedAt)}</p>
      <a className="text-link" href={`/reports/${report.id}`}>
        Open full report and pinned environment →
      </a>
    </section>
  );
}
