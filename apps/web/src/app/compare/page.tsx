import { reportComparisonSchema, reportEnvelopeSchema } from "@compatlab/contracts";
import { z } from "zod";
import { observedDate, readError } from "../../components/labels";
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
  const observation = z.object({
    observedAt: z.iso.datetime().nullable(),
    classifiedAt: z.iso.datetime(),
    classifierRevision: z.string().min(1).max(128),
  });
  const { comparison, beforeStatus, afterStatus, observations } = z
    .object({
      comparison: reportComparisonSchema,
      beforeStatus: reportEnvelopeSchema.shape.status,
      afterStatus: reportEnvelopeSchema.shape.status,
      observations: z.object({
        sameExecution: z.boolean(),
        before: observation,
        after: observation,
      }),
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
      <aside className="notice">
        <strong>{observations.sameExecution ? "Same execution" : "Separate executions"}</strong>
        <p>
          {observations.sameExecution
            ? "Both reports interpret the same recorded execution. A later classification does not mean the package was tested again."
            : "These reports describe separate executions. Differences in inputs or classification can affect the comparison."}
        </p>
        <p>
          Earlier report: executed {observedDate(observations.before.observedAt)}; classified{" "}
          {observedDate(observations.before.classifiedAt)} ({observations.before.classifierRevision}
          ).
        </p>
        <p>
          Later report: executed {observedDate(observations.after.observedAt)}; classified{" "}
          {observedDate(observations.after.classifiedAt)} ({observations.after.classifierRevision}).
        </p>
      </aside>
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
      <h2>Changed inputs and interpretation</h2>
      <p>
        Dependency, runtime and policy changes can affect results. This comparison does not
        establish what caused a change. A classifier revision changes the interpretation of retained
        evidence; it does not rerun the package.
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
                {item.regression
                  ? observations.sameExecution
                    ? "Changed interpretation. "
                    : "Regressed observation. "
                  : ""}
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
