"use client";
import { assertionManifestSchema } from "@compatlab/contracts";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const overviewSchema = z.object({
  assertions: z
    .array(
      z.object({
        id: z.uuid(),
        digest: z.string(),
        repositoryLinkId: z.uuid().nullable(),
        repository: z.string(),
        commit: z.string(),
        manifest: assertionManifestSchema,
        revokedAt: z.string().nullable(),
      }),
    )
    .max(10),
});
export function Assertions({
  repositories,
}: {
  repositories: { id: string; fullName: string; revokedAt: string | null }[];
}) {
  const [items, setItems] = useState<z.infer<typeof overviewSchema>["assertions"]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/maintainer/assertions", { cache: "no-store" });
    if (!response.ok) throw new Error("Assertion settings are unavailable.");
    setItems(overviewSchema.parse(await response.json()).assertions);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setMessage("Assertion settings are unavailable."));
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
        })
        .parse(await response.json());
      if (!response.ok || ["blocked", "throttled"].includes(result.kind ?? ""))
        throw new Error(
          `Request unavailable: ${(result.error ?? result.reason ?? "check your repository authority").replaceAll("_", " ")}.`,
        );
      if (path === "rescan" && result.scanId) {
        window.location.assign(`/scans/${result.scanId}`);
        return;
      }
      await refresh();
      setMessage("Assertion settings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const links = repositories.filter((link) => !link.revokedAt);
  return (
    <section aria-label="Named assertions">
      <h2>Named assertions</h2>
      <p>
        Register a manifest from an authorized public repository at an exact commit. Each
        observation can run one named assertion with offline fixtures under the standard sandbox
        limits. <a href="/methodology">Read the method and limits</a>.
      </p>
      <p role="status" aria-label="Assertion status">
        {message}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action("assertions", {
            repositoryLinkId: data.get("repositoryLinkId"),
            commit: data.get("commit"),
            manifestPath: data.get("manifestPath"),
          });
        }}
      >
        <label htmlFor="assertion-repository">Assertion repository</label>
        <select id="assertion-repository" name="repositoryLinkId" required>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.fullName}
            </option>
          ))}
        </select>
        <label htmlFor="assertion-commit">Full commit SHA</label>
        <input id="assertion-commit" name="commit" required pattern="[a-f0-9]{40}" maxLength={40} />
        <label htmlFor="assertion-manifest">Manifest path from repository root</label>
        <input
          id="assertion-manifest"
          name="manifestPath"
          required
          maxLength={256}
          defaultValue=".compatlab/manifest.json"
        />
        <button type="submit" disabled={busy || !links.length}>
          Register assertion
        </button>
      </form>
      <p className="fine">
        Ten revisions per account, including revoked revisions. Changing source, fixtures or
        permissions requires a new revision. No code runs during registration.
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <h3>{item.manifest.name}</h3>
            <p>
              {item.manifest.packageName} {item.manifest.packageRange} ·{" "}
              {item.revokedAt ? "Revoked" : "Available"}
            </p>
            <p>{item.manifest.expectedBehavior}</p>
            <p>
              <a href={`https://github.com/${item.repository}/commit/${item.commit}`}>
                Pinned source commit
              </a>{" "}
              · revision <code>{item.digest.slice(0, 16)}</code>
            </p>
            {!item.revokedAt && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void action("rescan", {
                      previousScanId: data.get("previousScanId"),
                      repositoryLinkId: item.repositoryLinkId,
                      assertionRevisionId: item.id,
                    });
                  }}
                >
                  <label htmlFor={`assertion-parent-${item.id}`}>
                    Previous scan ID for this package version
                  </label>
                  <input
                    id={`assertion-parent-${item.id}`}
                    name="previousScanId"
                    required
                    maxLength={36}
                  />
                  <button type="submit" disabled={busy}>
                    Run assertion in a new observation
                  </button>
                </form>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void action("assertions/revoke", { id: item.id })}
                >
                  Revoke assertion
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
