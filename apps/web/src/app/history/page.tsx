import { reportHistorySchema } from "@compatlab/contracts";
import { observedDate, packageUrl, readError } from "../../components/labels";
import { publicRead } from "../../server/runtime";

export const metadata = { title: "Report history", robots: { index: false, follow: true } };
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[]; before?: string | string[] }>;
}) {
  const query = await searchParams;
  const name = typeof query.name === "string" ? query.name : "";
  const before = typeof query.before === "string" ? query.before : undefined;
  const response = await publicRead(
    `/api/v1/history?${new URLSearchParams({ name, ...(before ? { before } : {}) })}`,
  );
  if (!response.ok)
    return (
      <section className="page narrow">
        <h1>History unavailable</h1>
        <p>
          {response.status === 400 ? "Select a valid package name." : readError(response.status)}
        </p>
        <a className="button" href="/">
          Explore packages
        </a>
      </section>
    );
  const history = reportHistorySchema.parse(await response.json());
  return (
    <section className="page">
      <a className="back" href={packageUrl(history.name)}>
        ← Package details
      </a>
      <p className="eyebrow">Retained observations</p>
      <h1>{history.name} report history</h1>
      <p className="lede">
        Each observation is retained independently. Reclassification and rescanning preserve their
        previous evidence.
      </p>
      {history.reports.length > 0 && (
        <form action="/compare" className="comparison-form" aria-label="Compare report history">
          <div className="field">
            <label htmlFor="before-report">Earlier report ID</label>
            <input
              id="before-report"
              name="before"
              list="history-reports"
              maxLength={36}
              spellCheck={false}
              required
              aria-describedby="comparison-help"
            />
          </div>
          <div className="field">
            <label htmlFor="after-report">Later report ID</label>
            <input
              id="after-report"
              name="after"
              list="history-reports"
              maxLength={36}
              spellCheck={false}
              required
              aria-describedby="comparison-help"
            />
          </div>
          <datalist id="history-reports">
            {history.reports.map((report) => (
              <option
                key={report.id}
                value={report.id}
                label={`${report.version} · observation ${report.observationRevision} · ${report.createdAt.slice(0, 10)}`}
              />
            ))}
          </datalist>
          <div className="actions">
            <button type="submit">Compare reports</button>
            <p className="fine" id="comparison-help">
              Choose or paste two report IDs for this package.
            </p>
          </div>
        </form>
      )}
      <ul className="history-list" aria-label="Recorded reports">
        {history.reports.map((report) => (
          <li key={report.id}>
            <div className="row">
              <a href={`/reports/${report.id}`}>
                <strong>{report.version}</strong> · observation {report.observationRevision}
              </a>
              <span className="fine">
                {report.current ? "Current evidence" : "Historical evidence"}
              </span>
            </div>
            <p className="fine">
              {report.matrixRevision} · {observedDate(report.createdAt)}
            </p>
            <p className="fine">
              Report ID: <code>{report.id}</code>
            </p>
          </li>
        ))}
      </ul>
      {!history.reports.length && <p>No reports have been recorded yet.</p>}
      {history.next && (
        <a href={`/history?${new URLSearchParams({ name: history.name, before: history.next })}`}>
          Older reports
        </a>
      )}
    </section>
  );
}
