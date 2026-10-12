import type { ReportCell } from "@compatlab/contracts";
import { FailureDetails } from "./failure-details";
import { labels } from "./labels";

type Entry = ReportCell["entries"][number];
export function entryLabel(entry: Entry) {
  if (entry.failure?.optionalPeer) return "Requires optional peer";
  if (entry.isolation && entry.outcome !== "fail")
    return entry.outcome === "pass" ? "Passed in a fresh process" : "Unconfirmed batch failure";
  return labels[entry.outcome];
}

export function EntryDetails({ entry }: { entry: Entry }) {
  const confirmation = entry.isolation?.confirmation;
  return (
    <>
      <p className="fine">
        {entry.durationMs === null
          ? "Duration unavailable"
          : `${entry.durationMs} ms in the original load`}
        {entry.resolvedTo && ` · Originally resolved to ${entry.resolvedTo}`}
      </p>
      {entry.isolation && (
        <>
          <p className="fine">
            Failed in the shared batch after entry {entry.isolation.priorFailureIndex + 1} failed in
            the same process.{" "}
            {!confirmation
              ? "No fresh-process confirmation was recorded; this result is inconclusive."
              : confirmation.stopReason !== "completed"
                ? `Its fresh-process confirmation stopped (${confirmation.stopReason.replaceAll("_", " ")}) and was not retried; this result is inconclusive.`
                : entry.outcome === "pass"
                  ? "It loaded in a fresh process."
                  : "It also failed in a fresh process; that failure follows."}
          </p>
          <details>
            <summary>Original batch failure</summary>
            <FailureDetails failure={entry.isolation.batchFailure} />
          </details>
        </>
      )}
      {entry.failure && <FailureDetails failure={entry.failure} />}
    </>
  );
}
