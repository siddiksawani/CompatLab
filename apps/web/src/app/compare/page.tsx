import { reportComparisonSchema, reportEnvelopeSchema } from "@compatlab/contracts";
import { z } from "zod";
import { readError } from "../../components/labels";
import { publicRead } from "../../server/runtime";

export const metadata = { title: "Compare reports", robots: { index: false, follow: true } };
export default async function ComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[]; after?: string | string[] }>;
}) {
  const query = await searchParams;
  const response = await publicRead(
    `/api/v1/comparisons?${new URLSearchParams({ before: typeof query.before === "string" ? query.before : "", after: typeof query.after === "string" ? query.after : "" })}`,
  );
  if (!response.ok)
    return (
      <section className="page narrow">
        <h1>Comparison unavailable</h1>
        <p>
          {[400, 404].includes(response.status)
            ? "Select two reports for the same package."
            : readError(response.status)}
        </p>
        <a className="button" href="/">
          Explore packages
        </a>
      </section>
    );
  const { comparison, beforeStatus, afterStatus } = z
    .object({
      comparison: reportComparisonSchema,
      beforeStatus: reportEnvelopeSchema.shape.status,
      afterStatus: reportEnvelopeSchema.shape.status,
    })
    .parse(await response.json());
  return (
    <section className="page">
      <a
        className="back"
        href={`/history?${new URLSearchParams({ name: comparison.packageName })}`}
      >
        ← Report history
      </a>
      <p className="eyebrow">Evidence comparison</p>
      <h1>Compare {comparison.packageName}</h1>
      <p>
        <a href={`/reports/${comparison.beforeReportId}`}>{comparison.beforeVersion} report</a> →{" "}
        <a href={`/reports/${comparison.afterReportId}`}>{comparison.afterVersion} report</a>
      </p>
      {(!beforeStatus.current || !afterStatus.current) && (
        <aside className="notice warning">
          This comparison includes historical or invalidated evidence. Inspect both reports before
          drawing conclusions.
        </aside>
      )}
      <p>
        {comparison.comparable
          ? `${comparison.totalChanges} meaningful evidence changes.`
          : "Service failure prevents a package regression conclusion."}
      </p>
      <h2>Changed inputs</h2>
      <p>
        Dependency, runtime and policy changes can affect results. This comparison does not
        establish what caused a change.
      </p>
      {comparison.inputs.length ? (
        <dl className="provenance">
          {comparison.inputs.map((item) => (
            <div key={item.field}>
              <dt>{item.field.replaceAll("_", " ")}</dt>
              <dd>
                <code>{item.before}</code> → <code>{item.after}</code>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>No recorded input differences.</p>
      )}
      <h2>Evidence changes</h2>
      {comparison.changes.length ? (
        <ul className="change-list">
          {comparison.changes.map((item) => (
            <li key={item.subject}>
              <strong>{item.subject}</strong>
              <p>
                {item.regression ? "Regressed observation. " : ""}
                <code>{item.before}</code> → <code>{item.after}</code>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No meaningful evidence changes. Timing and log differences are ignored.</p>
      )}
      {comparison.changesTruncated && (
        <p>The first 256 changes are shown. The linked reports retain complete evidence.</p>
      )}
      <ul>
        {comparison.limitations.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}
