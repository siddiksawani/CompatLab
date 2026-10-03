"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const overviewSchema = z.object({
  emailAvailable: z.boolean(),
  monitors: z
    .array(
      z.object({
        id: z.uuid(),
        packageName: z.string(),
        versionRange: z.string(),
        rule: z.enum(["regressions_only", "any_evidence_change"]),
        enabled: z.boolean(),
        emailEnabled: z.boolean(),
        lastError: z.string().nullable(),
        lastCheckedAt: z.string().nullable(),
      }),
    )
    .max(5),
  releases: z
    .array(
      z.object({
        monitorId: z.uuid(),
        version: z.string(),
        state: z.string(),
        error: z.string().nullable(),
        scanId: z.uuid().nullable(),
        reportId: z.uuid().nullable(),
      }),
    )
    .max(50)
    .default([]),
  notifications: z
    .array(
      z.object({
        id: z.uuid(),
        packageName: z.string(),
        beforeReportId: z.uuid(),
        afterReportId: z.uuid(),
        createdAt: z.string(),
        deliveryState: z.string().nullable(),
      }),
    )
    .max(50),
});
type Repository = { id: string; fullName: string; revokedAt: string | null };
export function Monitors({ repositories }: { repositories: Repository[] }) {
  const [overview, setOverview] = useState<z.infer<typeof overviewSchema> | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [rescan, setRescan] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/maintainer/monitors", { cache: "no-store" });
    if (!response.ok) throw new Error("Monitoring settings are unavailable.");
    setOverview(overviewSchema.parse(await response.json()));
  }, []);
  useEffect(() => {
    setRescan(new URLSearchParams(window.location.search).get("rescan") ?? "");
    void refresh().catch(() => setMessage("Monitoring settings are unavailable."));
  }, [refresh]);
  async function action(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/maintainer/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = z
        .object({
          error: z.string().optional(),
          kind: z.string().optional(),
          reason: z.string().optional(),
          scanId: z.uuid().optional(),
          reportId: z.uuid().optional(),
        })
        .passthrough()
        .parse(await response.json());
      if (!response.ok || result.kind === "blocked" || result.kind === "throttled")
        throw new Error(
          result.error === "fresh_sign_in_required"
            ? "Sign out and sign in again to change these settings."
            : `Request unavailable: ${(result.error ?? result.reason ?? "check your repository access").replaceAll("_", " ")}.`,
        );
      if (path === "rescan" && result.scanId) {
        window.location.assign(`/scans/${result.scanId}`);
        return;
      }
      await refresh();
      setMessage("Monitoring settings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const links = repositories.filter((link) => !link.revokedAt);
  return (
    <section aria-label="Release monitoring">
      <h2>Release monitoring</h2>
      <p>
        Monitor up to five package ranges. The published package must name your authorized GitHub
        repository. The first observation establishes a quiet baseline.
      </p>
      <p role="status" aria-label="Monitoring status">
        {message}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action("monitors", {
            repositoryLinkId: data.get("repositoryLinkId"),
            packageName: data.get("packageName"),
            versionRange: data.get("versionRange"),
            rule: data.get("rule"),
            emailEnabled: data.get("emailEnabled") === "on",
          });
        }}
      >
        <label htmlFor="monitor-repository">Authorized repository</label>
        <select id="monitor-repository" name="repositoryLinkId" required>
          {links.map((link) => (
            <option value={link.id} key={link.id}>
              {link.fullName}
            </option>
          ))}
        </select>
        <label htmlFor="monitor-package">Package name</label>
        <input id="monitor-package" name="packageName" required maxLength={214} />
        <label htmlFor="monitor-range">Version range</label>
        <input id="monitor-range" name="versionRange" required maxLength={256} defaultValue="*" />
        <label htmlFor="monitor-rule">Notify me about</label>
        <select id="monitor-rule" name="rule">
          <option value="regressions_only">Regressed observations</option>
          <option value="any_evidence_change">Any meaningful evidence change</option>
        </select>
        <label>
          <input type="checkbox" name="emailEnabled" disabled={!overview?.emailAvailable} /> Also
          email my verified GitHub address
        </label>
        {overview && !overview.emailAvailable && (
          <p className="fine">Email delivery is not configured. Changes remain visible here.</p>
        )}
        <button type="submit" disabled={busy || !overview || !links.length}>
          Create monitor
        </button>
      </form>
      <ul>
        {overview?.monitors.map((item) => (
          <li key={item.id}>
            <strong>
              {item.packageName} {item.versionRange}
            </strong>
            <p>
              {item.enabled ? "Monitoring enabled" : "Paused"} · {item.rule.replaceAll("_", " ")}
              {item.lastCheckedAt ? ` · checked ${item.lastCheckedAt.slice(0, 16)} UTC` : ""}
            </p>
            {item.lastError && <p>Last poll: {item.lastError.replaceAll("_", " ")}.</p>}
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void action("monitors/update", {
                  id: item.id,
                  enabled: !item.enabled,
                  emailEnabled: item.emailEnabled,
                })
              }
            >
              {item.enabled ? "Pause" : "Resume"}
            </button>
            {overview.emailAvailable && (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action("monitors/update", {
                    id: item.id,
                    enabled: item.enabled,
                    emailEnabled: !item.emailEnabled,
                  })
                }
              >
                {item.emailEnabled ? "Stop email" : "Enable email"}
              </button>
            )}
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void action("monitors/delete", { id: item.id })}
            >
              Delete monitor
            </button>
          </li>
        ))}
      </ul>
      <h3>Recent selections</h3>
      <ul>
        {overview?.releases.map((item) => (
          <li key={`${item.monitorId}:${item.version}`}>
            {item.version}:{" "}
            {item.reportId ? (
              <a href={`/reports/${item.reportId}`}>View report</a>
            ) : item.scanId ? (
              <a href={`/scans/${item.scanId}`}>View scan</a>
            ) : (
              item.state
            )}
            {item.error ? ` · ${item.error.replaceAll("_", " ")}` : ""}
          </li>
        ))}
      </ul>
      <h3>Recent changes</h3>
      <ul>
        {overview?.notifications.map((item) => (
          <li key={item.id}>
            <a href={`/compare?before=${item.beforeReportId}&after=${item.afterReportId}`}>
              {item.packageName} comparison
            </a>{" "}
            · {item.createdAt.slice(0, 10)} ·{" "}
            {item.deliveryState ? `email ${item.deliveryState}` : "in account"}
          </li>
        ))}
      </ul>
      {!overview?.notifications.length && <p>No meaningful changes recorded yet.</p>}
      <h3>Controlled rescan</h3>
      <p>
        A rescan creates a new observation and keeps the previous report. Account limits and package
        cooldowns apply.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action("rescan", {
            previousScanId: rescan,
            repositoryLinkId: data.get("repositoryLinkId"),
          });
        }}
      >
        <label htmlFor="rescan-id">Previous scan ID</label>
        <input
          id="rescan-id"
          value={rescan}
          onChange={(event) => setRescan(event.target.value)}
          required
          maxLength={36}
        />
        <label htmlFor="rescan-repository">Repository for this package</label>
        <select id="rescan-repository" name="repositoryLinkId" required>
          {links.map((link) => (
            <option value={link.id} key={link.id}>
              {link.fullName}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !links.length}>
          Request rescan
        </button>
      </form>
    </section>
  );
}
