import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("maintainers see an explanation and coming-soon status without account requests", async ({
  page,
}) => {
  const accountRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(maintainer|auth)\//.test(request.url())) accountRequests.push(request.url());
  });
  await page.goto("/account?installation_id=91&rescan=old-observation");
  await expect(page.getByRole("heading", { name: "Maintainers", exact: true })).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(page.getByText(/people who develop and release npm packages/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we’re planning" })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(accountRequests).toEqual([]);
  await page.getByRole("link", { name: "Explore packages", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search npm packages" })).toBeVisible();
});

test("policy and methodology pages describe maintainer tools as upcoming", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Maintainer tools: coming soon" })).toBeVisible();
  await page.getByRole("link", { name: "See what’s planned for maintainers." }).click();
  await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("link", { name: "Maintainer tools are coming soon." })).toBeVisible();
  await expect(page.getByRole("link", { name: "account settings", exact: true })).toHaveCount(0);
});
