import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { reportEnvelopeSchema } from "../../packages/contracts/dist/index.js";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});
test("optional peers explain inconclusive results while retaining failed loading evidence", async ({
  page,
  request,
}, info) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request, "execute-optional-peers");
  const reportUrl = new URL(page.url()).pathname;
  const before = await (await fixture(request, "counts")).json();
  await expect(
    page.getByRole("complementary", { name: "Optional peer requirements" }),
  ).toContainText("inconclusive");
  await expect(page.locator(".report-summary .result")).toHaveText("Inconclusive");
  const cell = page.locator("#node_24_21_0-subpaths-esm");
  await cell.locator("summary").click();
  await expect(cell).toContainText("1 passed · 1 needs an optional peer");
  await expect(cell).toContainText("Requires optional peer: @fixture/renderer");
  await expect(cell).toContainText("Declared range: ^2.0.0");
  await cell.getByRole("button", { name: "Load entry details", exact: true }).click();
  await expect(cell.locator(".entry-list li").last()).toContainText("Requires optional peer");
  const raw = await request.get(`${reportUrl.replace("/reports/", "/api/v1/reports/")}/json`);
  const { report } = reportEnvelopeSchema.parse(await raw.json());
  const subpaths = report.cells.find((entry) => entry.group === "subpaths");
  expect(subpaths?.coverage).toMatchObject({
    observed: 2,
    passed: 1,
    failed: 1,
    prerequisiteLimited: 1,
  });
  const evidenceUrl = await cell.getByRole("link", { name: "Evidence JSON" }).getAttribute("href");
  const evidence = await request.get(evidenceUrl ?? "");
  expect((await evidence.json()).evidence.observations[1].outcome).toBe("fail");
  const markdown = await request.get(reportUrl, { headers: { accept: "text/markdown" } });
  expect(await markdown.text()).toContain("1 needs an optional peer");
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectResponsiveLayout(page);
    await page.screenshot({ path: info.outputPath(`optional-peers-${width}.png`), fullPage: true });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
});
test("explains temporary scan pauses without navigating away", async ({ page }) => {
  await page.route("**/api/v1/scans", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "retry-after": "60" },
      body: JSON.stringify({
        kind: "throttled",
        reason: "worker_unavailable",
        retryAfterSeconds: 60,
      }),
    }),
  );
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
  await page.getByRole("button", { name: "Request a scan", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Scan requests are temporarily paused. Existing reports remain available.",
  );
  await expect(page).toHaveURL(/\/packages\?/);
});
for (const name of ["compatlab-browser-fixture", "@compatlab/browser-fixture"]) {
  test(`anonymous discovery and refresh recovery: ${name}`, async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search npm packages" }).fill(name);
    await page.locator(".search-results li > a:first-child").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByLabel("Exact version", { exact: true }).selectOption("2.0.0");
    await page.getByRole("button", { name: "Select version", exact: true }).click();
    await expect(page.getByText("Deprecated by the publisher", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Request a scan", exact: true }).click();
    await expect(page).toHaveURL(/\/scans\/[a-f0-9-]+$/);
    const scanUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(scanUrl);
    await expect(page.getByRole("heading", { name: "requested", exact: true })).toBeVisible();
    await finish(page, request);
    await expect(page.locator("body")).not.toContainText("Sign in");
    const before: unknown = await (await fixture(request, "counts")).json();
    const report = reportEnvelopeSchema.parse(
      await (
        await request.get(
          `${new URL(page.url()).pathname.replace("/reports/", "/api/v1/reports/")}/json`,
        )
      ).json(),
    );
    expect(report.report.artifact).toMatchObject({ name, version: "2.0.0" });
    await page.reload();
    await page.getByRole("link", { name: "← Package details", exact: true }).click();
    await page.getByRole("link", { name: "View report", exact: true }).click();
    expect(await (await fixture(request, "counts")).json()).toEqual(before);
  });
}
test("scan admission waits for client initialization before accepting clicks", async ({ page }) => {
  let release: () => void = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0", {
      waitUntil: "commit",
    });
    const button = page.getByRole("button", { name: "Request a scan", exact: true });
    await expect(button).toBeDisabled();
    release();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page).toHaveURL(/\/scans\/[a-f0-9-]+$/);
    await expect(page.getByRole("heading", { name: "requested", exact: true })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
test("evidence controls wait for client initialization before accepting clicks", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  let release: () => void = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    const cell = page.locator(".cell-details").first();
    await cell.locator("summary").click();
    const button = cell.getByRole("button", { name: "Load entry details", exact: true });
    await expect(button).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Copy report link", exact: true }),
    ).toBeDisabled();
    release();
    await expect(button).toBeEnabled();
    await expect(page.getByRole("button", { name: "Copy report link", exact: true })).toBeEnabled();
    await button.click();
    await expect(cell.locator(".entry-list")).toContainText("compatlab-browser-fixture");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
test("lazy logs remain text, expire visibly, and reflect report invalidation", async ({
  page,
  request,
}) => {
  const logs: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/logs?")) logs.push(request.url());
  });
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  expect(logs).toHaveLength(0);
  const cell = page.locator(".cell-details").first();
  await cell.locator("summary").focus();
  await page.keyboard.press("Enter");
  await cell.getByRole("button", { name: "Load entry details", exact: true }).click();
  await expect(cell.locator(".entry-list")).toContainText("compatlab-browser-fixture");
  await cell.getByRole("button", { name: "Load raw logs", exact: true }).click();
  await expect(cell.getByRole("textbox", { name: "Session 1 standard output" })).toHaveValue(
    "<script>window.packageCodeExecuted=true</script>",
  );
  expect(await page.evaluate(() => Reflect.has(window, "packageCodeExecuted"))).toBe(false);
  expect(logs).toHaveLength(1);
  await fixture(request, "expire-logs");
  await cell.getByRole("button", { name: "Refresh logs", exact: true }).click();
  await expect(
    cell.getByText("These logs have expired. The report and provenance remain available."),
  ).toBeVisible();
  await fixture(request, "invalidate");
  await page.reload();
  await expect(page.getByText("Historical evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser invalidation fixture.", { exact: true })).toBeVisible();
});
test("public pages support keyboard use, mobile layout and automated accessibility checks", async ({
  page,
  request,
  browserName,
}, info) => {
  await page.goto("/");
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
  );
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  await requestScan(page, "@compatlab/browser-fixture");
  await finish(page, request);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("report.png"), fullPage: true });
  await page.getByRole("link", { name: "Methodology", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Methodology", exact: true })).toBeVisible();
});
test("missing artifacts cannot request work", async ({ page, request }) => {
  await page.goto("/packages?name=missing-browser-fixture&version=1.0.0");
  await expect(page.getByRole("heading", { name: "Package unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a scan", exact: true })).toHaveCount(0);
  expect(await (await fixture(request, "counts")).json()).toEqual({ scans: 0, jobs: 0 });
});
test("history, comparisons and badges read immutable evidence without scheduling work", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const before = await (await fixture(request, "counts")).json();
  await page.getByRole("link", { name: "Report history", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "compatlab-browser-fixture report history" }),
  ).toBeVisible();
  await page.getByLabel("Earlier report ID").fill(id ?? "");
  await page.getByLabel("Later report ID").fill(id ?? "");
  await page.getByRole("button", { name: "Compare reports" }).click();
  await expect(
    page.getByText("No meaningful evidence changes. Timing and log differences are ignored."),
  ).toBeVisible();
  const badge = await request.get(`/api/v1/badges/${id}.svg`);
  expect(await badge.text()).toContain("loading evidence");
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("named failures remain separate from automatic loading evidence", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  const { scanId } = await (await fixture(request, "assertion")).json();
  await page.goto(`/scans/${scanId}`);
  await finish(page, request);
  const section = page.getByRole("region", { name: "Named assertion results" });
  await expect(section).toContainText("documented-behavior");
  await expect(section).toContainText("probe verified");
  await expect(section).toContainText("Expected behavior failed.");
  await expect(page.getByText("Runtime evidence / smoke tested", { exact: true })).toBeVisible();
  await expect(section.getByRole("link", { name: "Pinned source" })).toHaveAttribute(
    "href",
    `https://github.com/owner/package/commit/${"a".repeat(40)}`,
  );
  const before = await (await fixture(request, "counts")).json();
  await page.reload();
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
