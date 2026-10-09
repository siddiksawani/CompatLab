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
    await expect(page).toHaveTitle(`${name}@1.0.0: Node.js, Bun & Deno compatibility | CompatLab`);
    await expect(
      page.getByRole("heading", { name: `Does ${name} work with Bun?`, exact: true }),
    ).toBeVisible();
    const breadcrumbs = JSON.parse(
      await page.locator('script[type="application/ld+json"]').innerText(),
    );
    expect(breadcrumbs["@type"]).toBe("BreadcrumbList");
    expect(breadcrumbs.itemListElement.at(-1).item).toBe(page.url());
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
    await page.goto("/npm/compatibility");
    await expect(page.getByRole("link", { name: `${name}@1.0.0`, exact: true })).toHaveAttribute(
      "href",
      path,
    );
    await page.goto("/npm/compatibility/failures");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(
      page.getByText(
        "No eligible reports currently contain a qualifying loading failure for this selection.",
        {
          exact: false,
        },
      ),
    ).toBeVisible();
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
    expect(await (await request.get("/sitemaps/pages.xml")).text()).not.toContain(
      "/npm/compatibility/failures",
    );
    expect(sitemaps.join("").split(path).length - 1).toBe(1);
    const agentGuide = await request.get("/llms.txt");
    expect(agentGuide.headers()["content-type"]).toContain("text/markdown");
    expect(agentGuide.headers()["content-signal"]).toBe("search=yes, ai-input=yes, ai-train=no");
    expect(await agentGuide.text()).toContain("status.current");
    const reportMarkdown = await request.get(new URL(reportUrl).pathname, {
      headers: { accept: "text/markdown" },
    });
    expect(reportMarkdown.headers()["content-type"]).toContain("text/markdown");
    expect(await reportMarkdown.text()).toContain("work with Bun");
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
    await page.goto("/npm/compatibility");
    await expect(page.getByRole("link", { name: `${name}@1.0.0`, exact: true })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    expect(await (await request.get("/sitemaps/pages.xml")).text()).not.toContain(
      "/npm/compatibility",
    );
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
