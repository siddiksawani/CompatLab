import {
  type CompatibilityEvidence,
  compatibilityScope,
  runtimeAnswers,
} from "../server/compatibility-copy";

export function CompatibilityAnswers({ report }: { report: CompatibilityEvidence }) {
  return (
    <section className="report-section compatibility-answers" id="compatibility">
      <h2>Does {report.artifact.name} work in Node.js, Bun and Deno?</h2>
      <p>{compatibilityScope(report)}</p>
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
