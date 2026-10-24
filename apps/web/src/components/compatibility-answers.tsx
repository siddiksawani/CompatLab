import { displayIdentifier } from "@compatlab/engine";
import {
  applicationNextTest,
  type CompatibilityEvidence,
  compatibilityScope,
  omittedCoverage,
  runtimeAnswers,
} from "../server/compatibility-copy";

export function CompatibilityAnswers({ report }: { report: CompatibilityEvidence }) {
  const omitted = omittedCoverage(report);
  const nextTest = applicationNextTest(report);
  return (
    <section className="report-section compatibility-answers" id="compatibility">
      <h2>Does {report.artifact.name} work in Node.js, Bun and Deno?</h2>
      <p>{compatibilityScope(report)}</p>
      {omitted && (
        <aside className="notice warning">
          <h3>Exports outside these checks</h3>
          <p>
            The planner omitted {omitted.count} export {omitted.count === 1 ? "entry" : "entries"}.
            This is untested coverage, not evidence that those imports fail.
          </p>
          <ul>
            {omitted.samples.map((entry) => (
              <li key={`${entry.subpath}-${entry.explanation}`}>
                <code>{displayIdentifier(entry.subpath)}</code>: {entry.explanation}.
              </li>
            ))}
          </ul>
          <p>
            Test the exact import your application uses, then exercise its expected behavior.{" "}
            <a href={`/reports/${report.id}#planner-omissions`}>
              See all recorded planner omissions
            </a>
            .
          </p>
        </aside>
      )}
      {runtimeAnswers(report).map(({ kind, question, results }) => (
        <section key={kind} id={`compatibility-${kind}`}>
          <h3>{question}</h3>
          {results.map((result) => (
            <div key={result.profileId}>
              <p>
                {result.answer} <span className="fine">{result.counts}.</span>
              </p>
              {!!result.failures.length && (
                <ul>
                  {result.failures.map((failure) => (
                    <li key={failure.path}>
                      <a href={failure.path}>{failure.label}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
      {nextTest && (
        <section id="compatibility-next-test">
          <h3>Next test after a loading pass</h3>
          {nextTest.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}
      <p>
        <a href="/npm/compatibility">
          Compare npm package compatibility across Node.js, Bun and Deno
        </a>
        {" · "}
        <a href="/npm/compatibility/failures">Browse observed runtime loading failures</a>
      </p>
    </section>
  );
}
