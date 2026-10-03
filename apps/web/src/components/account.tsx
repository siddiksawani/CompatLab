"use client";

import { useCallback, useEffect, useState } from "react";

type AccountState = {
  enabled: boolean;
  user?: { name: string; email: string } | null;
  installationUrl?: string;
  repositories?: { id: string; fullName: string; revokedAt: string | null; verifiedAt: string }[];
};
const messages: Record<string, string> = {
  fresh_sign_in_required: "Please sign out and sign in again before changing account settings.",
  github_sign_in_required: "GitHub access has expired or was revoked. Please sign in again.",
  repository_authority_required:
    "Choose a public, active repository where you have push, maintain or admin access.",
  app_installation_required: "Install this GitHub App on the selected repository first.",
  installation_repository_required: "The repository is not available to this App installation.",
  request_limit: "Too many requests. Please wait ten minutes and try again.",
};
export function Account() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [repository, setRepository] = useState("");
  const [installationId, setInstallationId] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/maintainer/account", { cache: "no-store" });
    if (!response.ok) throw new Error("Account information is temporarily unavailable.");
    setAccount((await response.json()) as AccountState);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("installation_id");
    if (id && /^[1-9][0-9]{0,15}$/.test(id)) setInstallationId(id);
    if (params.has("error")) setMessage("GitHub sign-in did not complete. Please try again.");
    void refresh().catch(() => setMessage("Account information is temporarily unavailable."));
  }, [refresh]);
  async function action(path: string, body: object = {}) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; url?: string };
      if (!response.ok)
        throw new Error(
          messages[data.error ?? ""] ??
            "The request could not be completed. Check your access and try again.",
        );
      if (data.url && new URL(data.url).origin === "https://github.com") {
        window.location.assign(data.url);
        return;
      }
      await refresh();
      setMessage("Account settings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Account settings" className="account-settings">
      <p role="status" aria-live="polite">
        {message || (!account ? "Loading account…" : "")}
      </p>
      {account && !account.enabled && (
        <p>Maintainer sign-in is not configured on this installation yet.</p>
      )}
      {account?.enabled && !account.user && (
        <button
          disabled={busy}
          type="button"
          onClick={() => void action("/api/auth/sign-in/social", { provider: "github" })}
        >
          Sign in with GitHub
        </button>
      )}
      {account?.user && (
        <>
          <p>
            Signed in as <strong>{account.user.name}</strong> ({account.user.email}).
          </p>
          <button disabled={busy} type="button" onClick={() => void action("/api/auth/sign-out")}>
            Sign out
          </button>
          <h2>Repository authority</h2>
          <p>
            Repository authorization confirms GitHub access. It does not verify npm publisher or
            artifact ownership. Access is checked again before maintainer actions.
          </p>
          <p>
            <a href={account.installationUrl} rel="noreferrer">
              Install or configure the GitHub App
            </a>{" "}
            with access only to the public repositories you want to link.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action("/api/maintainer/repositories", { repository, installationId });
            }}
          >
            <label htmlFor="repository">Repository (owner/name)</label>
            <input
              id="repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              required
              maxLength={140}
              placeholder="owner/package"
            />
            <label htmlFor="installation">App installation ID</label>
            <input
              id="installation"
              value={installationId}
              onChange={(event) => setInstallationId(event.target.value)}
              required
              inputMode="numeric"
              pattern="[1-9][0-9]{0,15}"
              aria-describedby="installation-help"
            />
            <p id="installation-help" className="fine">
              Filled after installation, or copy the numeric ID from the App installation settings
              URL.
            </p>
            <button disabled={busy} type="submit">
              Verify and link repository
            </button>
          </form>
          <ul>
            {account.repositories?.map((link) => (
              <li key={link.id}>
                <a href={`https://github.com/${link.fullName}`} rel="noreferrer">
                  {link.fullName}
                </a>{" "}
                — {link.revokedAt ? "Access revoked" : "Repository authorized"}
                {!link.revokedAt && (
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void action("/api/maintainer/repositories/revoke", { id: link.id })
                    }
                  >
                    Revoke {link.fullName}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h2>Revoke or delete</h2>
          <p>
            Revoking removes stored GitHub tokens and signs out all sessions. Deleting also removes
            repository links and account settings. Public scan evidence is retained.
          </p>
          <button
            disabled={busy}
            type="button"
            onClick={() => void action("/api/maintainer/revoke")}
          >
            Revoke GitHub access
          </button>{" "}
          <button
            disabled={busy}
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Delete your CompatLab account and its settings? Public reports will remain.",
                )
              )
                void action("/api/auth/delete-user");
            }}
          >
            Delete account
          </button>
          <p className="fine">
            You can also revoke the App directly in GitHub’s application settings. Sensitive changes
            require a sign-in within the last ten minutes.
          </p>
        </>
      )}
    </section>
  );
}
