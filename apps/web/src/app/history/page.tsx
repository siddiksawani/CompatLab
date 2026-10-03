import { reportHistorySchema } from "@compatlab/contracts";
import { publicRead } from "../../server/runtime";
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; before?: string }>;
}) {
  const query = await searchParams;
  const response = await publicRead(
    `/api/v1/history?${new URLSearchParams({ name: query.name ?? "", ...(query.before ? { before: query.before } : {}) })}`,
  );
  if (!response.ok)
    return (
      <section className="page">
        <h1>History unavailable</h1>
        <p>Select a valid package name.</p>
      </section>
    );
  const history = reportHistorySchema.parse(await response.json());
  return (
    <section className="page">
      <h1>{history.name} report history</h1>
      <p>
        Each observation is retained independently. Reclassification and rescanning preserve their
        previous evidence.
      </p>
      <form action="/compare">
        <label htmlFor="before-report">Earlier report ID</label>
        <input id="before-report" name="before" required />
        <label htmlFor="after-report">Later report ID</label>
        <input id="after-report" name="after" required />
        <button type="submit">Compare reports</button>
      </form>
      <ul>
        {history.reports.map((report) => (
          <li key={report.id}>
            <a href={`/reports/${report.id}`}>
              {report.version} · observation {report.observationRevision}
            </a>{" "}
            · {report.matrixRevision} · {report.createdAt.slice(0, 10)}
            {report.current ? "" : " · historical"}
            <p className="mono">{report.id}</p>
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
