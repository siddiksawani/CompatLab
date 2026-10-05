import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

test("version selection works without JavaScript", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("Browser tests require a base URL");
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
    await page.getByRole("combobox", { name: "Exact version", exact: true }).selectOption("2.0.0");
    await page.getByRole("button", { name: "Select version", exact: true }).click();
    await expect(page).toHaveURL(/version=2.0.0/);
    await page.getByText("Enter another exact version", { exact: true }).click();
    await page.getByLabel("Other exact version", { exact: true }).fill("0.0.0");
    await page.getByRole("button", { name: "Open version", exact: true }).click();
    await expect(page).toHaveURL(/version=0.0.0/);
  } finally {
    await context.close();
  }
});

test("version menus select published versions and keep older exact versions reachable", async ({
  page,
}) => {
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
  const versions = page.getByRole("combobox", { name: "Exact version", exact: true });
  await expect(versions).toHaveJSProperty("tagName", "SELECT");
  await versions.selectOption("2.0.0");
  await page.getByRole("button", { name: "Select version", exact: true }).click();
  await expect(page).toHaveURL(/version=2.0.0/);
  await expect(page.getByText("Deprecated by the publisher", { exact: true })).toBeVisible();
  await expect(versions.locator('option[value="0.0.0"]')).toHaveCount(0);
  await page.getByText("Enter another exact version", { exact: true }).click();
  await page.getByLabel("Other exact version", { exact: true }).fill("0.0.0");
  await page.getByRole("button", { name: "Open version", exact: true }).click();
  await expect(page).toHaveURL(/version=0.0.0/);
  await expect(versions).toHaveValue("0.0.0");
  await expect(versions.locator('option[value="0.0.0"]')).toHaveCount(1);
});

test("homepage previews link to stored evidence without creating scan work", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByText("No completed reports yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Example reports" })).toHaveCount(0);
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request, "execute-mixed");
  const reportUrl = page.url();
  const counts: unknown = await (await fixture(request, "counts")).json();
  for (const width of [375, 390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".report-preview")).toContainText("compatlab-browser-fixture");
    await expect(page.locator(".report-preview")).toContainText("Linux amd64 / glibc");
    await expect(page.locator(".report-preview")).toContainText("Planned checks completed");
    await expect(page.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      "e.g. zod or @scope/name",
    );
    await expect(page.locator(".recent-report-list .result")).toHaveText("Mixed results");
    const versionSize = await page
      .locator(".recent-report-meta .mono")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(versionSize).toBeGreaterThanOrEqual(15);
    const activeMatrix = page.locator(
      width < 900 ? ".report-preview .mobile-matrix" : ".report-preview .desktop-matrix",
    );
    await expect(activeMatrix).toBeVisible();
    await expect(activeMatrix).toContainText("1 passed · 1 failed");
    await expect(activeMatrix).not.toContainText("observed");
    if (width === 375) {
      const search = await page.locator(".hero-search").boundingBox();
      const preview = await page.locator(".report-preview").boundingBox();
      expect(preview?.y).toBeGreaterThanOrEqual((search?.y ?? 0) + (search?.height ?? 0));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await expectResponsiveLayout(page);
    const searchBounds = await page.getByRole("searchbox").boundingBox();
    expect(searchBounds?.height).toBeLessThanOrEqual(60);
    if (width === 1280) {
      const bounds = await page.locator(".report-preview").boundingBox();
      expect(bounds && bounds.y + bounds.height).toBeLessThan(900);
    }
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("region", { name: "Example reports" }).getByRole("link").click();
  await expect(page).toHaveURL(reportUrl);
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
  await fixture(request, "invalidate");
  await page.goto("/");
  await expect(page.locator(".report-preview")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Example reports" })).toHaveCount(0);
});

test("navigation highlights the current page and section links target real content", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const mainNav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(mainNav.getByRole("link")).toHaveCount(3);
  await expect(mainNav.getByRole("link", { name: "Search", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const path of ["/methodology", "/privacy", "/security", "/terms"]) {
    await page.goto(path);
    const links = await page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link")
      .all();
    for (const link of links) {
      const target = await link.getAttribute("href");
      expect(target).toMatch(/^#[a-z-]+$/);
      await expect(page.locator(target ?? "")).toHaveCount(1);
    }
    if (path === "/methodology")
      await expect(mainNav.getByRole("link", { name: "Methodology", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
  }
  await page.getByRole("contentinfo").getByRole("link", { name: "Request removal" }).click();
  await expect(page).toHaveURL(/\/privacy#removal$/);
  await expect(page.getByRole("heading", { name: "Corrections and removal" })).toBeInViewport();
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Limits", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Evidence limitations" })).toBeInViewport();
});
