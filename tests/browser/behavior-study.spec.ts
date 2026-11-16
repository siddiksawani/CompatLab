import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, fixture } from "./helpers.js";

const path = "/articles/npm-behavior-study-2026-11";

test("behavior study exposes all frozen versions and raw evidence without starting scans", async ({
  browser,
  baseURL,
  request,
  page: interactive,
}) => {
  if (!baseURL) throw new Error("Browser base URL is required.");
  const before: unknown = await (await fixture(request, "counts")).json();
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page
      .getByRole("link", { name: "Study 2: what happened when we called the APIs" })
      .click();
    await expect(page).toHaveURL(`${baseURL}${path}`);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${baseURL}${path}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    const cohort = page.getByRole("region", { name: "Behavior results for all 24 packages" });
    await expect(cohort.locator("tbody tr")).toHaveCount(24);
    await expect(page.getByRole("article")).toContainText("do not estimate the failure rate");
    await expect(page.getByRole("article")).toContainText(
      "does not turn a loading badge into a behavior certificate",
    );
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectResponsiveLayout(page);
    }
    for (const file of ["results.json", "raw-results.json", "results.csv"]) {
      await expect(page.locator(`a[href="${path}/${file}"]`)).toBeVisible();
      const response = await request.get(`${path}/${file}`);
      expect(response.ok()).toBe(true);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
      expect(response.headers()["content-disposition"]).toContain("attachment");
    }
    const summary = await (await request.get(`${path}/results.json`)).json();
    expect(new Set(summary.packages.map((row: { name: string }) => row.name)).size).toBe(24);
    const raw = await (await request.get(`${path}/raw-results.json`)).json();
    const primary = raw.runs.find(
      (run: { sourceCommit: string }) => run.sourceCommit === summary.sourceCommit,
    );
    expect(primary.infrastructureError).toBeUndefined();
    expect(primary.results.length).toBe(summary.observations.length);
    for (const row of primary.results) {
      if (row.status === "pass") {
        expect(row.exitCode).toBe(0);
        expect(row.timedOut).toBe(false);
        if (row.completionRequired) expect(row.completionValid).toBe(true);
      } else {
        expect(row.replay).toBeDefined();
      }
    }
    expect(await (await request.get(`${path}/results.csv`)).text()).toContain("classification");
    expect((await request.get(`${path}/unknown.json`)).status()).toBe(404);
    for (const discovery of ["/sitemaps/pages.xml", "/index.md", "/llms.txt"]) {
      expect(await (await request.get(discovery)).text()).toContain(`${baseURL}${path}`);
    }
    await interactive.goto(path);
    expect((await new AxeBuilder({ page: interactive }).analyze()).violations).toEqual([]);
    expect(await (await fixture(request, "counts")).json()).toEqual(before);
  } finally {
    await context.close();
  }
});
