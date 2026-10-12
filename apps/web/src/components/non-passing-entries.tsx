import type { ReportCell } from "@compatlab/contracts";
import { EntryDetails, entryLabel } from "./entry-details";
import { entryPath } from "./entry-result";

export function NonPassingEntries({ reportId, cell }: { reportId: string; cell: ReportCell }) {
  const entries = cell.entries.filter((entry) => entry.outcome !== "pass");
  if (!entries.length) return null;
  return (
    <section aria-label="Non-passing import results">
      <h3>Non-passing imports</h3>
      <p className="fine">
        {entries.length > 6
          ? `Showing the first 6 of ${entries.length} non-passing entries. Load all observations below for the rest.`
          : "Recorded loading errors and inconclusive entries are shown here without loading raw logs."}
      </p>
      <ul>
        {entries.slice(0, 6).map((entry) => (
          <li key={entry.index}>
            <a href={entryPath(reportId, cell, entry.index)}>
              <code>{entry.displaySpecifier}</code>
            </a>{" "}
            <span className={`result ${entry.outcome}`}>{entryLabel(entry)}</span>
            <EntryDetails entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}
