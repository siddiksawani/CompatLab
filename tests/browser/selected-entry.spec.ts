import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

test("matrix results open their entries and share one prerequisite result", async ({
  page,
  request,
  browser,
}, info) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (/\/(cell|logs)\?/.test(request.url())) reads.push(request.url());
  });
  await requestScan(page, "@compatlab/browser-fixture");
  await finish(page, request, "execute-optional-peers");
  const reportUrl = page.url();
  const before = await (await fixture(request, "counts")).json();
  const anchor = "node_24_21_0-subpaths-esm";
  await page.locator(`#runtime-matrix a[href="#${anchor}"]:visible`).click();
  const cell = page.locator(`#${anchor}`);
  await expect(cell).toHaveAttribute("open", "");
  await expect(cell.locator(".entry-list li")).toHaveCount(2);
  expect(reads.filter((url) => url.includes("/cell?"))).toHaveLength(1);
  expect(reads.filter((url) => url.includes("/logs?"))).toHaveLength(0);
  await cell.getByRole("link", { name: "Open and share this result" }).last().click();
  await expect(page).toHaveURL(new RegExp(`\\?cell=${anchor}&entry=1#selected-result$`));
  const selected = page.getByRole("region", { name: "Selected import result" });
  await expect(selected).toContainText("Requires optional peer: @fixture/renderer");
  await expect(selected).toContainText("Node.js 24.21.0");
  await expect(selected).toContainText("ESM import");
  await expect(selected).toContainText("@compatlab/browser-fixture@1.0.0");
  await expect(selected).toContainText("Observed");
  await expect(selected.getByRole("button", { name: "Copy this result link" })).toBeEnabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }),
  );
  await selected.getByRole("button", { name: "Copy this result link" }).click();
  await expect(selected.getByRole("textbox", { name: "Copy this result link" })).toHaveValue(
    page.url(),
  );
  await page.getByRole("button", { name: "Copy report link", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Copy report link", exact: true })).toHaveValue(
    page.url(),
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", reportUrl);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectResponsiveLayout(page);
    await selected.screenshot({ path: info.outputPath(`selected-result-${width}.png`) });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const reader = await context.newPage();
    await reader.goto(reportUrl);
    const preview = reader.locator(`#${anchor}`);
    await preview.locator("summary").first().click();
    await expect(preview.getByRole("region", { name: "Non-passing import results" })).toContainText(
      "Requires optional peer: @fixture/renderer",
    );
    await preview
      .getByRole("link", { name: "@compatlab/browser-fixture/missing", exact: true })
      .click();
    await expect(reader.getByRole("region", { name: "Selected import result" })).toContainText(
      "@fixture/renderer",
    );
    await reader.goto(page.url());
    await expect(reader.getByRole("region", { name: "Selected import result" })).toContainText(
      "@fixture/renderer",
    );
  } finally {
    await context.close();
  }
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
  expect(reads.filter((url) => url.includes("/logs?"))).toHaveLength(0);
  await page.goto(`${reportUrl}?cell=${anchor}&entry=999#selected-result`);
  await expect(page.getByRole("status")).toContainText("This entry selection is not available");
  await expect(page.getByRole("region", { name: "Selected import result" })).toHaveCount(0);
});

test("a loading pass can record undefined without claiming a usable API", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request, "execute-value-types");
  const reportUrl = page.url();
  await page.goto(`${reportUrl}?cell=bun_1_4_2-root-commonjs&entry=0#selected-result`);
  const selected = page.getByRole("region", { name: "Selected import result" });
  await expect(selected).toContainText("Recorded return type: undefined.");
  await expect(selected).toContainText("does not establish a usable API");
  await expect(selected).toContainText("Bun 1.4.2 · CommonJS require");
  await expect(selected.locator(".result")).toHaveText("Passed");
  await selected.getByRole("link", { name: "Next test after a loading pass" }).click();
  await expect(page.locator("#compatibility-next-test")).toContainText(
    "Call the operation your application needs from compatlab-browser-fixture@1.0.0",
  );
  await fixture(request, "invalidate");
  await page.reload();
  await expect(page.getByText("Historical evidence", { exact: true })).toBeVisible();
  await expect(selected).toContainText("Recorded return type: undefined.");
});
