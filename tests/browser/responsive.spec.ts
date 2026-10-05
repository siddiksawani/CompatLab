import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  expectResponsiveLayout,
  finish,
  fixture,
  longPackageName,
  requestScan,
} from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

const informationPages = ["/account", "/methodology", "/privacy", "/terms", "/security"];
async function expectAccessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
  test(`public layouts fit ${width}px with long package names and expanded evidence`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    await page.goto("/");
    await expectResponsiveLayout(page);
    await page.getByRole("searchbox", { name: "Search npm packages" }).fill(longPackageName);
    await expect(page.getByRole("list", { name: "Package results" })).toContainText(
      longPackageName,
    );
    await expectResponsiveLayout(page);
    await page.locator(".search-results li > a:first-child").click();
    await expect(page.getByRole("heading", { name: longPackageName, exact: true })).toBeVisible();
    await expectResponsiveLayout(page);
    if (width === 390) await expectAccessible(page);
    await page.getByRole("button", { name: "Request a scan", exact: true }).click();
    await expect(page).toHaveURL(/\/scans\/[a-f0-9-]+$/);
    await expectResponsiveLayout(page);
    if (width === 390) await expectAccessible(page);
    await finish(page, request);
    const reportId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expectResponsiveLayout(page);
    await expect(
      page.getByRole("link", { name: "Maintainer tools (coming soon)" }),
    ).toHaveAttribute("href", "/account");
    await expect(page.locator(width <= 900 ? ".mobile-matrix" : ".desktop-matrix")).toBeVisible();
    const cell = page.locator(".cell-details").first();
    await cell.locator("summary").click();
    await cell.getByRole("button", { name: "Load entry details", exact: true }).click();
    await expect(cell.locator(".entry-list")).toContainText(longPackageName);
    await cell.getByRole("button", { name: "Load raw logs", exact: true }).click();
    await expect(cell.getByRole("textbox", { name: "Session 1 standard output" })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Exact provenance" }).click();
    await expectResponsiveLayout(page);
    await page.getByRole("link", { name: "Report history", exact: true }).click();
    await expectResponsiveLayout(page);
    if (width === 390) await expectAccessible(page);
    await page.getByLabel("Earlier report ID").fill(reportId);
    await page.getByLabel("Later report ID").fill(reportId);
    await page.getByRole("button", { name: "Compare reports" }).click();
    await expect(page.getByRole("heading", { name: `Compare ${longPackageName}` })).toBeVisible();
    await expectResponsiveLayout(page);
    for (const path of [
      ...informationPages,
      "/missing-page",
      "/reports/not-a-report",
      "/scans/not-a-scan",
      "/packages?name=missing-browser-fixture",
      "/history",
      "/compare",
    ]) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectResponsiveLayout(page);
      });
    }
    expect(errors).toEqual([]);
  });
}

test("information pages and recovery links remain accessible", async ({ page }) => {
  for (const path of [...informationPages, "/missing-page", "/history", "/compare"]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }
  await page.getByRole("link", { name: "Explore packages", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search npm packages" })).toBeVisible();
});

test("changed comparison inputs and clipboard fallback stay readable on narrow screens", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Clipboard unavailable");
        },
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 850 });
  await requestScan(page, longPackageName);
  await finish(page, request);
  const before = new URL(page.url()).pathname.split("/").at(-1);
  await expect(page.locator("#reproduction")).toContainText(
    "Hosted runtime images are not yet distributed for public download",
  );
  await page.getByText("Command for a configured host", { exact: true }).click();
  await page.getByRole("button", { name: "Copy reproduction command", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Copy reproduction command" })).toHaveValue(
    /sudo "\$\(command -v node\)" apps\/cli\/dist\/bin\.js reproduce/,
  );
  await expectResponsiveLayout(page);
  await requestScan(page, longPackageName, "2.0.0");
  await finish(page, request);
  const after = new URL(page.url()).pathname.split("/").at(-1);
  await page.goto(`/compare?before=${before}&after=${after}`);
  await expect(page.locator(".provenance")).toContainText("1.0.0");
  await expectResponsiveLayout(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectResponsiveLayout(page);
});
