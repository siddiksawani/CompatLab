import type { NormalizedFailure } from "@compatlab/contracts";

export function FailureDetails({ failure }: { failure: NormalizedFailure }) {
  return (
    <div className="failure-text">
      {failure.optionalPeer && (
        <p>
          <strong>
            Requires optional peer: <code>{failure.optionalPeer.name}</code>
          </strong>
          <br />
          Declared range: <code>{failure.optionalPeer.range}</code>. This dependency was not
          installed in the tested snapshot. Compatibility for this entry is inconclusive; the
          loading error does not establish a runtime incompatibility.
        </p>
      )}
      <p>
        <code>{failure.classification}</code> · {failure.phase.replaceAll("_", " ")}
        <br />
        {failure.message ||
          "No error message was captured. The cause of this loading failure is unknown."}
      </p>
    </div>
  );
}
