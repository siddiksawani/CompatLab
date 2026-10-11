"use client";
import { type ReportCell, reportCellSchema } from "@compatlab/contracts";
import { useEffect, useState } from "react";
import { z } from "zod";
import { FailureDetails } from "./failure-details";
import { labels } from "./labels";

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
function confirmationText({ isolation, outcome }: ReportCell["entries"][number]) {
  const confirmation = isolation?.confirmation;
  if (!confirmation)
    return "No fresh-process confirmation was recorded; this result is inconclusive.";
  if (confirmation.stopReason !== "completed")
    return `Its fresh-process confirmation stopped (${confirmation.stopReason.replaceAll("_", " ")}) and was not retried; this result is inconclusive.`;
  return outcome === "pass"
    ? "It loaded in a fresh process."
    : "It also failed in a fresh process; that failure follows.";
}
function logTitle({ confirmedIndex }: Logs["sessions"][number], index: number) {
  return confirmedIndex === undefined
    ? `Session ${index + 1}`
    : `Fresh confirmation of entry ${confirmedIndex + 1}`;
}
export function Evidence({ reportId, runId }: { reportId: string; runId: string }) {
  const [cell, setCell] = useState<ReportCell | null>(null);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function load(includeLogs: boolean) {
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
      setBusy(false);
    }
  }
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
                    <span className={`result ${entry.outcome}`}>
                      {entry.failure?.optionalPeer
                        ? "Requires optional peer"
                        : entry.isolation && entry.outcome !== "fail"
                          ? entry.outcome === "pass"
                            ? "Passed in a fresh process"
                            : "Unconfirmed batch failure"
                          : labels[entry.outcome]}
                    </span>
                  </div>
                  <p className="fine">
                    {entry.durationMs === null ? "Duration unavailable" : `${entry.durationMs} ms`}
                    {entry.resolvedTo && ` · Resolved to ${entry.resolvedTo}`}
                  </p>
                  {entry.isolation && (
                    <>
                      <p className="fine">
                        Failed in the shared batch after entry{" "}
                        {entry.isolation.priorFailureIndex + 1} failed in the same process.{" "}
                        {confirmationText(entry)}
                      </p>
                      <FailureDetails failure={entry.isolation.batchFailure} />
                    </>
                  )}
                  {entry.failure && <FailureDetails failure={entry.failure} />}
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
