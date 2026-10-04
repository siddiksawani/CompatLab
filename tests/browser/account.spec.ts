import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("accounts remain optional when GitHub is not configured", async ({ page }) => {
  await page.goto("/account");
  await expect(
    page.getByText("Maintainer sign-in is not configured on this installation yet."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search npm packages" })).toBeVisible();
});
test("repository settings explain authority and recover from a stale session", async ({ page }) => {
  await page.route("**/api/maintainer/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        user: { name: "fixture-maintainer", email: "fixture@example.com" },
        installationUrl: "https://github.com/apps/compatlab-test/installations/new",
        repositories: [
          {
            id: "d15fa6fc-7e02-43f5-8e37-6c1471a86c19",
            fullName: "owner/package",
            revokedAt: null,
            verifiedAt: "2026-10-04T00:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/maintainer/repositories", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repository: "owner/package",
      installationId: "91",
    });
    await route.fulfill({ status: 403, json: { error: "fresh_sign_in_required" } });
  });
  await page.route("**/api/maintainer/monitors", (route) =>
    route.fulfill({ json: { emailAvailable: false, monitors: [], notifications: [] } }),
  );
  await page.goto("/account?installation_id=91");
  await expect(page.getByText("Repository authorized", { exact: false })).toBeVisible();
  await expect(page.getByText(/does not verify npm publisher/)).toBeVisible();
  await page.getByLabel("Repository (owner/name)").fill("owner/package");
  await expect(page.getByLabel("App installation ID")).toHaveValue("91");
  await page.getByRole("button", { name: "Verify and link repository" }).click();
  await expect(page.getByRole("status", { name: "Account status" })).toContainText(
    "sign out and sign in again",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("maintainers create monitors, pause alerts and follow immutable comparisons", async ({
  page,
}) => {
  const linkId = "d15fa6fc-7e02-43f5-8e37-6c1471a86c19",
    monitorId = "af19e1a0-cebd-49ca-9e28-f22a6ab575df";
  await page.route("**/api/maintainer/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        user: { name: "fixture", email: "fixture@example.com" },
        repositories: [
          {
            id: linkId,
            fullName: "owner/package",
            revokedAt: null,
            verifiedAt: "2026-10-04T00:00:00Z",
          },
        ],
      },
    }),
  );
  let created = false,
    enabled = true;
  await page.route("**/api/maintainer/monitors", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        repositoryLinkId: linkId,
        packageName: "fixture",
        versionRange: "^1.0.0",
        rule: "any_evidence_change",
        emailEnabled: true,
      });
      created = true;
      await route.fulfill({ json: { id: monitorId } });
      return;
    }
    await route.fulfill({
      json: {
        emailAvailable: true,
        monitors: created
          ? [
              {
                id: monitorId,
                packageName: "fixture",
                versionRange: "^1.0.0",
                rule: "any_evidence_change",
                enabled,
                emailEnabled: true,
                lastError: null,
                lastCheckedAt: null,
              },
            ]
          : [],
        notifications: [],
      },
    });
  });
  await page.route("**/api/maintainer/monitors/update", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      id: monitorId,
      enabled: false,
      emailEnabled: true,
    });
    enabled = false;
    await route.fulfill({ json: { updated: true } });
  });
  await page.goto("/account");
  await page.getByLabel("Package name", { exact: true }).fill("fixture");
  await page.getByLabel("Version range").fill("^1.0.0");
  await page.getByLabel("Notify me about").selectOption("any_evidence_change");
  await page.getByLabel("Also email my verified GitHub address").check();
  await page.getByRole("button", { name: "Create monitor", exact: true }).click();
  await expect(page.getByText("fixture ^1.0.0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("maintainers register and revoke a commit-pinned assertion with clear limits", async ({
  page,
}) => {
  const linkId = "d15fa6fc-7e02-43f5-8e37-6c1471a86c19",
    id = "af19e1a0-cebd-49ca-9e28-f22a6ab575df";
  await page.route("**/api/maintainer/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        user: { name: "fixture", email: "fixture@example.com" },
        repositories: [
          {
            id: linkId,
            fullName: "owner/package",
            revokedAt: null,
            verifiedAt: "2026-10-04T00:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/maintainer/monitors", (route) =>
    route.fulfill({ json: { emailAvailable: false, monitors: [], notifications: [] } }),
  );
  let created = false,
    revokedAt: string | null = null;
  await page.route("**/api/maintainer/assertions", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        repositoryLinkId: linkId,
        commit: "a".repeat(40),
        manifestPath: ".compatlab/manifest.json",
      });
      created = true;
      await route.fulfill({ json: { id } });
      return;
    }
    await route.fulfill({
      json: {
        assertions: created
          ? [
              {
                id,
                digest: "b".repeat(64),
                repositoryLinkId: linkId,
                repository: "owner/package",
                commit: "a".repeat(40),
                revokedAt,
                manifest: {
                  schemaVersion: 1,
                  name: "example-behavior",
                  packageName: "fixture",
                  packageRange: "*",
                  entry: "probe.mjs",
                  timeoutMs: 1000,
                  capabilities: {
                    network: "none",
                    filesystem: "read_only_workspace_and_bounded_temporary_output",
                    processes: "bounded",
                  },
                  fixtures: [],
                  expectedBehavior: "The documented example succeeds.",
                },
              },
            ]
          : [],
      },
    });
  });
  await page.route("**/api/maintainer/assertions/revoke", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ id });
    revokedAt = "2026-10-04T00:00:00Z";
    await route.fulfill({ json: { revoked: true } });
  });
  await page.goto("/account");
  await page.getByLabel("Full commit SHA").fill("a".repeat(40));
  await page.getByRole("button", { name: "Register assertion", exact: true }).click();
  await expect(page.getByRole("heading", { name: "example-behavior" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pinned source commit" })).toHaveAttribute(
    "href",
    `https://github.com/owner/package/commit/${"a".repeat(40)}`,
  );
  await page.getByRole("button", { name: "Revoke assertion", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run assertion in a new observation" }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
