"use client";
import { type ScanProgress, scanProgressSchema } from "@compatlab/contracts";
import { useEffect, useState } from "react";
import { observedDate } from "./labels";

const terminal = new Set([
  "completed",
  "inconclusive",
  "failed_infrastructure",
  "rejected",
  "cancelled",
]);
const descriptions = {
  requested: "Waiting for an available worker. Refreshing this page will restore the same scan.",
  preparing: "Preparing a sealed dependency snapshot with install scripts disabled.",
  running: "Observing independent root modes and explicit subpath batches.",
  aggregating: "Preserving evidence and building the report.",
  completed: "Evidence is ready.",
  inconclusive: "The scan stopped with incomplete evidence.",
  failed_infrastructure:
    "The service could not complete this scan. This is not a package compatibility result.",
  rejected: "The scan is unavailable under the current service policy.",
  cancelled: "The scan was cancelled.",
};
export function Progress({
  initial,
  initialEtag,
}: {
  initial: ScanProgress;
  initialEtag: string | null;
}) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      running = false,
      finished = !!initial.reportId || !!initial.aggregationFailedAt,
      delay = 2000;
    let etag = initialEtag;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      if (stopped || running || finished || document.hidden) return;
      running = true;
      try {
        const response = await fetch(`/api/v1/scans/${initial.id}`, {
          headers: etag ? { "if-none-match": etag } : {},
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.status !== 304) {
          if (!response.ok) {
            delay = Math.min(
              30_000,
              Math.max(delay * 2, (Number(response.headers.get("retry-after")) || 2) * 1000),
            );
            throw new Error("Progress is temporarily unavailable. Reconnecting automatically…");
          }
          const current = scanProgressSchema.parse(await response.json());
          etag = response.headers.get("etag");
          setProgress(current);
          finished = !!current.aggregationFailedAt;
          if (current.reportId) {
            finished = true;
            window.location.replace(`/reports/${current.reportId}`);
          }
        }
        delay = 2000;
        setError("");
      } catch (error) {
        if (!stopped) {
          setError(error instanceof Error ? error.message : "Reconnecting…");
          delay = Math.min(30_000, delay * 2);
        }
      } finally {
        running = false;
        if (!stopped && !finished && !document.hidden) timer = setTimeout(() => void poll(), delay);
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [initial.id, initial.reportId, initial.aggregationFailedAt, initialEtag]);
  return (
    <div className="progress-panel">
      <div className="progress-heading">
        <span
          className={`state-dot ${terminal.has(progress.state) ? "stopped" : ""}`}
          aria-hidden="true"
        />
        <h2 aria-live="polite">{progress.state.replaceAll("_", " ")}</h2>
      </div>
      <p>{descriptions[progress.state]}</p>
      <dl className="counts">
        <div>
          <dt>Queued jobs</dt>
          <dd>{progress.jobs.queued}</dd>
        </div>
        <div>
          <dt>Active jobs</dt>
          <dd>{progress.jobs.active}</dd>
        </div>
        <div>
          <dt>Finished jobs</dt>
          <dd>{progress.jobs.finished}</dd>
        </div>
      </dl>
      <p className="fine">
        Jobs include preparation, runtime groups and report assembly. Counts are not a completion
        percentage.
      </p>
      <p className="fine">Requested {observedDate(progress.requestedAt)}</p>
      {error && (
        <p role="status" className="notice warning">
          {error}
        </p>
      )}
      {terminal.has(progress.state) && !progress.reportId && (
        <p>
          {progress.aggregationFailedAt
            ? "Report assembly failed. The retained evidence requires operator recovery."
            : "The terminal state is saved. A report will be available after evidence is assembled."}{" "}
          <a href={`/scans/${progress.id}`}>Refresh report</a>
        </p>
      )}
    </div>
  );
}
