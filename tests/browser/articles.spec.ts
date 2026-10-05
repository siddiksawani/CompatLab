import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, fixture } from "./helpers.js";

const articlePath = "/articles/npm-package-compatibility-node-bun-deno";

test("discovers the original article and exposes its evidence without admitting scans", async ({
  page,
  request,
}) => {
  const before: unknown = await (await fixture(request, "counts")).json();
  await page.goto("/");
  await page.locator(`.article-callout a[href="${articlePath}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  const url = page.url();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  const data = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  );
  expect(data.mainEntityOfPage).toBe(url);
  expect(data.headline).toBe(await page.getByRole("heading", { level: 1 }).textContent());
  expect(data.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(data.citation).toHaveLength(4);
  for (const report of data.citation) {
    await expect(
      page.locator(`article a[href="${new URL(report).pathname}"]`).first(),
    ).toBeVisible();
  }
  const origin = new URL(url).origin;
  expect(await (await request.get("/sitemaps/pages.xml")).text()).toContain(url);
  expect(await (await request.get("/index.md")).text()).toContain(url);
  await page.getByRole("article").getByRole("link", { name: "Articles", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/articles`);
  await expect(page.locator(`main a[href="${articlePath}"]`)).toBeVisible();
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
});

test("article content and evidence links are present without JavaScript", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser test base URL is required.");
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    const response = await page.goto(articlePath);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(2);
    await expect(page.locator('article a[href^="/reports/"]')).toHaveCount(8);
  } finally {
    await context.close();
  }
});

test("article navigation and result tables fit phone and desktop layouts", async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/articles", articlePath]) {
      await page.goto(path);
      await expectResponsiveLayout(page);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    await page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link", { name: "The results", exact: true })
      .click();
    await expect(page).toHaveURL(/#results$/);
    const region = page.getByRole("region", { name: "Package loading results", exact: true });
    await region.focus();
    await expect(region).toBeFocused();
  }
});
