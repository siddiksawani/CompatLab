import { type HostedReport, probeGroupResultSchema } from "@compatlab/contracts";
import { z } from "zod";
import { publicRead } from "../server/runtime";
import { Copy } from "./copy";
import { EntryDetails, entryLabel } from "./entry-details";
import { cellAnchor, entryPath, recordedValueType, type selectEntry } from "./entry-result";
import { observedDate } from "./labels";

const evidenceSchema = z.object({ runId: z.uuid(), evidence: probeGroupResultSchema.nullable() });

export async function SelectedEntry({
  report,
  selected,
  origin,
}: {
  report: HostedReport;
  selected: NonNullable<ReturnType<typeof selectEntry>>;
  origin: string;
}) {
  const { cell, entry } = selected;
  const runtime = report.matrix.images.find((image) => image.profileId === cell.profileId);
  let valueType: string | null = null;
  if (cell.runId && entry.outcome === "pass") {
    const response = await publicRead(`/api/v1/reports/${report.id}/evidence?runId=${cell.runId}`);
    if (response.ok) {
      const raw = evidenceSchema.safeParse(await response.json());
      if (raw.success && raw.data.runId === cell.runId)
        valueType = recordedValueType(cell, entry, raw.data.evidence);
    }
  }
  return (
    <section
      id="selected-result"
      className="report-section selected-result"
      aria-labelledby="selected-result-title"
    >
      <h2 id="selected-result-title">Selected import result</h2>
      <div className="row">
        <h3 className="break">
          <code>{entry.displaySpecifier}</code>
        </h3>
        <span className={`result ${entry.outcome}`}>{entryLabel(entry)}</span>
      </div>
      <p>
        {report.artifact.name}@{report.artifact.version} ·{" "}
        {runtime
          ? `${runtime.kind === "node" ? "Node.js" : runtime.kind === "bun" ? "Bun" : "Deno"} ${runtime.version}`
          : cell.profileId}
        {" · "}
        {cell.mode === "esm" ? "ESM import" : "CommonJS require"}
      </p>
      <p className="fine">
        Observed {observedDate(report.observedAt)} · Linux amd64 / glibc ·{" "}
        {cell.method === "fresh_root_v2" ? "Fresh root process" : "Sequential subpath batch"}
      </p>
      <EntryDetails entry={entry} />
      {entry.outcome === "pass" && (
        <p>
          {valueType === null ? (
            "The return type is unavailable in the retained evidence."
          ) : (
            <>
              Recorded return type: <code>{valueType}</code>.
            </>
          )}{" "}
          {valueType === "undefined"
            ? "The load completed but returned undefined. Check the exports your application needs; this does not establish a usable API."
            : cell.mode === "esm"
              ? "For import, this describes the module namespace. It does not check its named exports or behavior."
              : "This describes the value returned by require. It does not check its exports or behavior."}
        </p>
      )}
      {entry.failure?.optionalPeer && (
        <p>
          Provide the declared peer in your application and test the affected feature. This report
          does not establish that adding it resolves the failure.
        </p>
      )}
      <p className="fine">
        Loading success does not establish functional correctness or package safety. This is one
        entry; the report’s overall coverage and limitations still apply.
      </p>
      <div className="actions">
        <Copy
          label="Copy this result link"
          value={`${origin}${entryPath(report.id, cell, entry.index)}`}
        />
        <a href={`#${cellAnchor(cell)}`}>All entries and raw logs for this group</a>
        <a href={`/reports/${report.id}#runtime-matrix`}>Back to runtime matrix</a>
      </div>
    </section>
  );
}
