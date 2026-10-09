import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test("serves crawlable comparisons and runtime failures without JavaScript or scan creation", async ({
  page,
  request,
  browser,
}, info) => {
  await fixture(request, "reset");
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request, "execute-mixed");
  const reportUrl = page.url();
  const counts = await (await fixture(request, "counts")).json();
  await expect(page).toHaveTitle(
    "compatlab-browser-fixture@1.0.0: Node.js, Bun & Deno test report | CompatLab",
  );
  await expect(
    page.getByRole("heading", {
      name: "Does compatlab-browser-fixture work with Deno?",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/npm/compatibility/failures");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", page.url());
  await expect(
    page.getByRole("link", { name: "Full loading report for compatlab-browser-fixture@1.0.0" }),
  ).toHaveAttribute("href", new URL(reportUrl).pathname);
  await expect(page.locator(".runtime-outcomes")).toContainText("Bun");
  await expect(page.locator(".runtime-outcomes")).toContainText("Mixed results");
  await page
    .getByRole("navigation", { name: "Filter failures by runtime" })
    .getByRole("link", { name: "Bun", exact: true })
    .click();
  await expect(page).toHaveURL(/failures\?runtime=bun$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", page.url());
  await expect(
    page.getByText("Showing packages with recorded failures in Bun.", { exact: true }),
  ).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectResponsiveLayout(page);
    await page.screenshot({ path: info.outputPath(`directory-${width}.png`), fullPage: true });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await staticContext.newPage();
    await staticPage.goto(new URL("/npm/compatibility", reportUrl).href);
    await staticPage
      .getByRole("link", { name: "compatlab-browser-fixture@1.0.0", exact: true })
      .click();
    await expect(
      staticPage.getByRole("heading", {
        name: "Does compatlab-browser-fixture work with Bun?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(staticPage.locator("#compatibility-bun")).toContainText("mixed loading results");
  } finally {
    await staticContext.close();
  }
  const sitemap = await request.get("/sitemaps/pages.xml");
  expect(await sitemap.text()).toContain("/npm/compatibility/failures");
  for (const suffix of [
    "?after=bad",
    "?after=00000000-0000-4000-8000-000000000000",
    "?page=100000",
  ]) {
    expect((await request.get(`/npm/compatibility${suffix}`)).status()).toBe(404);
  }
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
});
