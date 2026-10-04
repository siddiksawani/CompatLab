"use client";
import { admissionResponseSchema } from "@compatlab/contracts";
import { useEffect, useState } from "react";

export function RequestScan({
  name,
  version,
  enabled,
}: {
  name: string;
  version: string;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, version }),
      });
      if (!response.ok) {
        setMessage(
          response.status === 503
            ? "Scan requests are temporarily paused. Existing reports remain available."
            : response.status === 429
              ? `The scan limit has been reached. Try again in ${response.headers.get("retry-after") || "30"} seconds.`
              : response.status === 403
                ? "This artifact or runtime profile is unavailable under the current service policy."
                : "A scan could not be requested. Please try again shortly.",
        );
        return;
      }
      const result = admissionResponseSchema.parse(await response.json());
      window.location.assign(
        result.kind === "cached" ? `/reports/${result.reportId}` : `/scans/${result.scanId}`,
      );
    } catch {
      setMessage(
        "The connection was interrupted. Retrying the same request safely finds existing work.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" disabled={!enabled || busy || !ready} onClick={() => void submit()}>
        {busy ? "Requesting scan…" : "Request a scan"}
      </button>
      <p className="fine" role="status">
        {message ||
          (!enabled
            ? "Scan requests are paused. Existing reports remain available."
            : "One shared preparation, then independent runtime observations. Public limits apply.")}
      </p>
    </div>
  );
}
