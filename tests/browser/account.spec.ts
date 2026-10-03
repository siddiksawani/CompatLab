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
  await page.goto("/account?installation_id=91");
  await expect(page.getByText("Repository authorized", { exact: false })).toBeVisible();
  await expect(page.getByText(/does not verify npm publisher/)).toBeVisible();
  await page.getByLabel("Repository (owner/name)").fill("owner/package");
  await expect(page.getByLabel("App installation ID")).toHaveValue("91");
  await page.getByRole("button", { name: "Verify and link repository" }).click();
  await expect(page.getByRole("status")).toContainText("sign out and sign in again");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
