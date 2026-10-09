import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, fixture } from "./helpers.js";

const articlePath = "/articles/npm-package-compatibility-node-bun-deno";
const mcpArticlePath = "/articles/mcp-npm-compatibility-ai-agents";

test("MCP guide is discoverable and explains evidence without starting scans", async ({
  page,
  request,
}) => {
  const before: unknown = await (await fixture(request, "counts")).json();
  await page.goto("/api");
  await page.getByRole("link", { name: "MCP setup and AI agent usage guide" }).click();
  await expect(page).toHaveURL(new RegExp(`${mcpArticlePath}$`));
  const url = page.url();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Claude Code, Cursor or Codex/,
  );
  const data = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "[]",
  );
  expect(data[0]).toMatchObject({
    "@type": "Article",
    mainEntityOfPage: url,
    datePublished: "2026-10-09",
    headline: await page.getByRole("heading", { level: 1 }).textContent(),
  });
  expect(data[1]["@type"]).toBe("BreadcrumbList");
  expect(data[1].itemListElement.at(-1).item).toBe(url);
  expect(data[0].citation).toHaveLength(3);
  for (const citation of data[0].citation) {
    await expect(
      page.locator(`article a[href="${new URL(citation).pathname}"]`).first(),
    ).toBeVisible();
  }
  await expect(page.getByRole("article")).toContainText("They do not start scans");
  await expect(page.getByRole("article")).toContainText("matchesCurrentMatrix");
  await expect(page.getByRole("article")).toContainText("no eligible recorded evidence");
  await expect(page.getByRole("article")).toContainText("Do not submit scans automatically");
  for (const path of ["/sitemaps/pages.xml", "/index.md", "/llms.txt"]) {
    expect(await (await request.get(path)).text()).toContain(url);
  }
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Articles", exact: true })
    .click();
  await expect(
    page
      .locator(".article-list-item")
      .filter({ has: page.locator(`a[href="${mcpArticlePath}"]`) })
      .locator("time"),
  ).toHaveText("October 9, 2026");
  await expect(
    page
      .locator(".article-list-item")
      .filter({ has: page.locator(`a[href="${articlePath}"]`) })
      .locator("time"),
  ).toHaveText("October 5, 2026");
  await page.goto("/");
  await expect(page.locator(`.article-callout a[href="${mcpArticlePath}"]`)).toBeVisible();
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
});

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
    await page.goto(mcpArticlePath);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Check npm compatibility with MCP: a guide for AI agents",
    );
    await expect(page.getByRole("heading", { name: "Claude Code", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cursor", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "claude mcp add" })).toContainText(
      "https://compatlab.me/mcp",
    );
    await expect(page.getByRole("table")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "express@5.2.1", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("article navigation and result tables fit phone and desktop layouts", async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/articles", mcpArticlePath, articlePath]) {
      await page.goto(path);
      await expectResponsiveLayout(page);
      if (path === mcpArticlePath) {
        const instructions = page
          .getByRole("region", { name: "Reusable agent instructions" })
          .locator("pre");
        await instructions.focus();
        await expect(instructions).toBeFocused();
      }
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
