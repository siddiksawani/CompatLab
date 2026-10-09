import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

async function packageSitemaps(request: APIRequestContext) {
  const pages: string[] = [];
  for (const prefix of "0123456789abcdef") {
    const response = await request.get(`/sitemaps/npm-${prefix}.xml`);
    expect(response.status()).toBe(200);
    pages.push(await response.text());
  }
  return pages;
}

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

for (const name of ["compatlab-browser-fixture", "@compatlab/browser-fixture"]) {
  test(`serves indexable ${name} version evidence with immutable report links`, async ({
    page,
    request,
  }, info) => {
    await requestScan(page, name);
    await finish(page, request, "execute-optional-peers");
    const reportUrl = page.url();
    const reportId = new URL(reportUrl).pathname.split("/").at(-1);
    const counts = await (await fixture(request, "counts")).json();
    const path = `/npm/${name}/1.0.0`;
    await page.getByRole("link", { name: "Version summary", exact: true }).click();
    await expect(page).toHaveURL(new URL(path, reportUrl).href);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", page.url());
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await expect(page.getByRole("link", { name: "Full report and provenance" })).toHaveAttribute(
      "href",
      new URL(reportUrl).pathname,
    );
    await expect(page.locator(".lede")).toContainText("inconclusive");
    await expect(page.getByRole("heading", { name: "Missing optional peers" })).toBeVisible();
    await expect(page.locator(".notice")).toContainText("@fixture/renderer");
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectResponsiveLayout(page);
      await page.screenshot({ path: info.outputPath(`package-${width}.png`), fullPage: true });
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const html = await request.get(path);
    expect(html.status()).toBe(200);
    expect(await html.text()).toContain("Missing optional peers");
    const summary = await request.get(`/api/v1/reports/${reportId}/summary`);
    expect(summary.status()).toBe(200);
    expect(await summary.json()).toMatchObject({
      reportPath: new URL(reportUrl).pathname,
      summary: {
        artifact: { name, version: "1.0.0" },
        missingOptionalPeers: [{ name: "@fixture/renderer", range: "^2.0.0" }],
      },
    });
    const sitemaps = await packageSitemaps(request);
    expect(sitemaps.join("").split(path).length - 1).toBe(1);
    const agentGuide = await request.get("/llms.txt");
    expect(agentGuide.headers()["content-type"]).toContain("text/markdown");
    expect(agentGuide.headers()["content-signal"]).toBe("search=yes, ai-input=yes, ai-train=no");
    expect(await agentGuide.text()).toContain("status.current");
    expect(html.headers().link).toContain('rel="describedby"');
    expect((await request.post("/llms.txt")).status()).toBe(405);
    expect(
      (await (await request.get("/openapi.json")).json()).paths["/api/v1/reports/{id}/summary"].get
        .operationId,
    ).toBe("getReportSummary");
    await fixture(request, "invalidate");
    const missing = await page.goto(path);
    expect(missing?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "No published evidence at this address" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const withdrawn = await packageSitemaps(request);
    expect(withdrawn.join("")).not.toContain(path);
    expect(await (await request.get(`/api/v1/reports/${reportId}/summary`)).json()).toMatchObject({
      status: { current: false },
    });
    expect(await (await fixture(request, "counts")).json()).toEqual(counts);
  });
}

test("distinguishes earlier environments and returns 404 for missing or malformed identities", async ({
  page,
  request,
}) => {
  const { scanId } = await (await fixture(request, "earlier-environment")).json();
  await page.goto(`/scans/${scanId}`);
  await finish(page, request);
  await page.getByRole("link", { name: "Version summary", exact: true }).click();
  await expect(page.getByText("Earlier execution environment", { exact: true })).toBeVisible();
  const counts = await (await fixture(request, "counts")).json();
  for (const path of [
    "/npm/compatlab-browser-fixture/latest",
    "/npm/compatlab-browser-fixture/2.0.0",
    "/npm/missing-fixture/1.0.0",
    "/npm/@compatlab/1.0.0",
    "/npm/compatlab-browser-fixture/1.0.0/extra",
    "/npm/compatlab-browser-fixture/%2E%2E%2Fbad",
    "/npm/%40compatlab%2Fbrowser-fixture/1.0.0",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
});
