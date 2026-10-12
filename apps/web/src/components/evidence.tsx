"use client";
import { type ReportCell, reportCellSchema } from "@compatlab/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { EntryDetails, entryLabel } from "./entry-details";
import { entryPath } from "./entry-result";

const logSchema = z.object({
  availability: z.enum(["available", "expired", "not_recorded"]),
  expiresAt: z.string().nullable(),
  sessions: z.array(
    z.object({
      probeId: z.string(),
      confirmedIndex: z.number().optional(),
      stdout: z.string(),
      stderr: z.string(),
      stdoutTruncated: z.boolean(),
      stderrTruncated: z.boolean(),
    }),
  ),
});
type Logs = z.infer<typeof logSchema>;
function logTitle({ confirmedIndex }: Logs["sessions"][number], index: number) {
  return confirmedIndex === undefined
    ? `Session ${index + 1}`
    : `Fresh confirmation of entry ${confirmedIndex + 1}`;
}
export function Evidence({
  reportId,
  runId,
  anchor,
}: {
  reportId: string;
  runId: string;
  anchor: string;
}) {
  const [cell, setCell] = useState<ReportCell | null>(null);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pending = useRef(false);
  useEffect(() => setReady(true), []);
  const load = useCallback(
    async (includeLogs: boolean) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/v1/reports/${reportId}/${includeLogs ? "logs" : "cell"}?runId=${runId}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!response.ok) throw new Error("Evidence is temporarily unavailable. Try again.");
        const value: unknown = await response.json();
        if (includeLogs) setLogs(logSchema.parse(value));
        else setCell(z.object({ cell: reportCellSchema }).parse(value).cell);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Evidence unavailable.");
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [reportId, runId],
  );
  useEffect(() => {
    function openTarget() {
      if (window.location.hash !== `#${anchor}`) return;
      const details = document.getElementById(anchor);
      if (details instanceof HTMLDetailsElement) details.open = true;
      if (!cell) void load(false);
    }
    function followTarget(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link?.getAttribute("href") === `#${anchor}`) {
        const details = document.getElementById(anchor);
        if (details instanceof HTMLDetailsElement) details.open = true;
        if (!cell) void load(false);
      }
    }
    openTarget();
    window.addEventListener("hashchange", openTarget);
    document.addEventListener("click", followTarget);
    return () => {
      window.removeEventListener("hashchange", openTarget);
      document.removeEventListener("click", followTarget);
    };
  }, [anchor, cell, load]);
  return (
    <div className="evidence">
      <div className="actions">
        <button
          className="secondary"
          type="button"
          disabled={busy || !ready}
          onClick={() => void load(false)}
        >
          {cell ? "Refresh entry details" : "Load entry details"}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy || !ready}
          onClick={() => void load(true)}
        >
          {logs ? "Refresh logs" : "Load raw logs"}
        </button>
        <a href={`/api/v1/reports/${reportId}/evidence?runId=${runId}`}>Evidence JSON</a>
      </div>
      {busy && <p role="status">Loading evidence…</p>}
      {error && <p role="status">{error}</p>}
      {cell && (
        <div>
          <p className="fine">
            {cell.method === "fresh_root_v2"
              ? "Fresh root process"
              : "Sequential batch with shared module cache"}{" "}
            · {cell.durationMs} ms · {cell.sessions.length} sessions
          </p>
          {cell.entries.length ? (
            <ol className="entry-list">
              {cell.entries.map((entry) => (
                <li key={entry.index}>
                  <div className="row">
                    <code className="break">{entry.displaySpecifier}</code>
                    <span className={`result ${entry.outcome}`}>{entryLabel(entry)}</span>
                  </div>
                  <p>
                    <a href={entryPath(reportId, cell, entry.index)}>Open and share this result</a>
                  </p>
                  <EntryDetails entry={entry} />
                </li>
              ))}
            </ol>
          ) : (
            <p>No applicable entries in this group.</p>
          )}
          {cell.sessions.map((session) => (
            <p className="fine" key={session.probeId}>
              Session starting at entry {session.startIndex + 1}:{" "}
              {session.stopReason.replaceAll("_", " ")} · exit {session.exitCode ?? "unknown"}
              {session.oomKilled ? " · memory limit reached" : ""}
            </p>
          ))}
        </div>
      )}
      {logs && (
        <section aria-label="Raw logs">
          <h4>Raw package logs</h4>
          <p className="fine">
            Sanitized text; never a verdict. {logs.expiresAt && `Retention ends ${logs.expiresAt}.`}
          </p>
          {logs.availability !== "available" ? (
            <p>
              {logs.availability === "expired"
                ? "These logs have expired. The report and provenance remain available."
                : "No logs were recorded."}
            </p>
          ) : (
            logs.sessions.map((session, index) => (
              <div key={session.probeId}>
                <h5>{logTitle(session, index)}</h5>
                <p>Standard output{session.stdoutTruncated ? " (truncated)" : ""}</p>
                <textarea
                  className="log-text"
                  readOnly
                  rows={8}
                  aria-label={`${logTitle(session, index)} standard output`}
                  value={session.stdout || "(empty)"}
                />
                <p>Standard error{session.stderrTruncated ? " (truncated)" : ""}</p>
                <textarea
                  className="log-text"
                  readOnly
                  rows={8}
                  aria-label={`${logTitle(session, index)} standard error`}
                  value={session.stderr || "(empty)"}
                />
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
