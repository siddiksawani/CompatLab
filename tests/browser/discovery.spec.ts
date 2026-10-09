import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

test("finds earlier environment reports without requesting new work", async ({
  page,
  request,
}, info) => {
  const { scanId } = await (await fixture(request, "earlier-environment")).json();
  await page.goto(`/scans/${scanId}`);
  await finish(page, request);
  const reportUrl = page.url();
  const before = await (await fixture(request, "counts")).json();
  await page.goto("/?q=compatlab-browser-fixture");
  await expect(
    page.getByRole("link", {
      name: /compatlab-browser-fixture.*Earlier environment report available/,
    }),
  ).toBeVisible();
  await page.locator(".search-results li > a:first-child").click();
  await expect(
    page.getByRole("heading", { name: "A report exists for an earlier environment." }),
  ).toBeVisible();
  await expect(page.locator(".scan-action")).toContainText("Observed:");
  await expect(
    page.getByRole("link", { name: "View earlier report", exact: true }),
  ).toHaveAttribute("href", new URL(reportUrl).pathname);
  await expect(page.getByRole("button", { name: "Request a scan", exact: true })).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectResponsiveLayout(page);
    await page.screenshot({
      path: info.outputPath(`earlier-environment-${width}.png`),
      fullPage: true,
    });
  }
  const markdown = await request.get("/?q=compatlab-browser-fixture", {
    headers: { accept: "text/markdown" },
  });
  expect(await markdown.text()).toContain(`[earlier environment report](${reportUrl})`);
  await page.getByRole("link", { name: "View earlier report", exact: true }).click();
  await expect(page).toHaveURL(reportUrl);
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
  await fixture(request, "invalidate");
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
  await expect(page.getByRole("link", { name: "View earlier report", exact: true })).toHaveCount(0);
});

test("keeps earlier evidence visible while a scan uses the current environment", async ({
  page,
  request,
}) => {
  const { scanId } = await (await fixture(request, "earlier-environment")).json();
  await page.goto(`/scans/${scanId}`);
  await finish(page, request);
  const previousReport = new URL(page.url()).pathname;
  await requestScan(page, "compatlab-browser-fixture");
  const progressUrl = page.url();
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
  await expect(
    page.getByRole("link", { name: "View earlier report", exact: true }),
  ).toHaveAttribute("href", previousReport);
  await expect(page.getByRole("link", { name: "View scan progress", exact: true })).toHaveAttribute(
    "href",
    new URL(progressUrl).pathname,
  );
  await expect(page.getByRole("button", { name: "Request a scan", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "View scan progress", exact: true }).click();
  await finish(page, request);
  const currentReport = new URL(page.url()).pathname;
  expect(currentReport).not.toBe(previousReport);
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0");
  await expect(page.getByRole("link", { name: "View report", exact: true })).toHaveAttribute(
    "href",
    currentReport,
  );
  await expect(page.getByRole("link", { name: "View earlier report", exact: true })).toHaveCount(0);
});

test("publishes canonical pages and excludes query and operational surfaces", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const canonical = page.locator('link[rel="canonical"]');
  await expect(canonical).toHaveAttribute("href", /^http/);
  expect(new URL((await canonical.getAttribute("href")) ?? "").href).toBe(`${origin}/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    new RegExp(`${origin.replaceAll(".", "\\.")}/opengraph-image`),
  );
  await page.goto("/?q=compatlab-browser-fixture");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  for (const path of [
    "/account",
    "/packages?name=compatlab-browser-fixture",
    "/compare",
    "/history",
  ]) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  expect((await request.get("/healthz")).headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(await (await request.get("/robots.txt")).text()).toContain(
    `Sitemap: ${origin}/sitemap.xml`,
  );
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain(`${origin}/sitemaps/pages.xml`);
  expect(index.match(/<sitemap>/g)).toHaveLength(17);
  const pages = await (await request.get("/sitemaps/pages.xml")).text();
  expect(pages).toContain(`${origin}/methodology`);
  expect(pages).not.toContain("/account");
  expect((await request.get("/sitemaps/invalid.xml")).status()).toBe(404);
  expect((await request.get("/opengraph-image")).headers()["content-type"]).toContain("image/png");
});

test("indexes completed evidence and withdraws invalidated reports from discovery", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await finish(page, request);
  const url = page.url();
  const id = new URL(url).pathname.split("/").at(-1) ?? "";
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  expect(await (await request.get(`/sitemaps/${id[0]}.xml`)).text()).toContain(url);
  const counts: unknown = await (await fixture(request, "counts")).json();
  await page.goto("/");
  await expect(page.locator(`.recent-reports a[href="/reports/${id}"]`)).toBeVisible();
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
  await fixture(request, "invalidate");
  await page.goto(url);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  expect(await (await request.get(`/sitemaps/${id[0]}.xml`)).text()).not.toContain(url);
});

test("advertises real read APIs and negotiates Markdown without changing browser responses", async ({
  page,
  request,
}) => {
  const html = await request.get("/");
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(html.headers().link).toContain('rel="api-catalog"');
  expect(html.headers().link).toContain('rel="service-desc"');
  expect(html.headers()["cache-control"]).toContain("no-store");
  expect(html.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
  const catalog = await request.get("/.well-known/api-catalog");
  expect(catalog.headers()["content-type"]).toContain("application/linkset+json");
  const linkset = (await catalog.json()).linkset[0];
  const spec = await (await request.get(linkset["service-desc"][0].href)).json();
  expect(spec.openapi).toBe("3.1.1");
  expect(spec.paths["/api/v1/packages"].get.operationId).toBe("getPackage");
  const guide = await request.get(linkset["service-doc"][0].href);
  expect(guide.ok()).toBe(true);
  expect(guide.headers()["x-robots-tag"]).toBeUndefined();
  expect(guide.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  await page.goto("/api");
  await expect(page.getByRole("heading", { name: "Public API", exact: true })).toBeVisible();
  for (const accept of ["*/*", "text/html, text/markdown", "text/markdown;q=0"]) {
    expect((await request.get("/", { headers: { accept } })).headers()["content-type"]).toContain(
      "text/html",
    );
  }
  const rsc = await request.get("/", { headers: { accept: "text/markdown", rsc: "1" } });
  expect(rsc.headers()["content-type"]).not.toContain("text/markdown");
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request, "execute-mixed");
  const reportUrl = page.url();
  const counts: unknown = await (await fixture(request, "counts")).json();
  const readMarkdown = (url: string) => request.get(url, { headers: { accept: "text/markdown" } });
  const home = await readMarkdown("/");
  expect(home.headers()["content-type"]).toContain("text/markdown");
  expect(home.headers()["cache-control"]).toContain("no-transform");
  expect(home.headers().vary?.toLowerCase().split(/,\s*/)).toContain("accept");
  expect(home.headers().link).toContain('rel="canonical"');
  expect(await home.text()).toContain("1 passed · 1 failed");
  expect(await home.text()).toContain(reportUrl);
  expect(await home.text()).not.toContain("<html");
  expect(
    (await request.head("/", { headers: { accept: "text/markdown" } })).headers()["content-type"],
  ).toContain("text/markdown");
  const report = await (await readMarkdown(reportUrl)).text();
  expect(report).toContain("Status: current evidence.");
  expect(report).toContain("Outcome: Mixed results.");
  expect(report).toContain("1 passed · 1 failed");
  expect(report).not.toContain("window.packageCodeExecuted");
  expect(report).toEqual(await (await request.get(`${reportUrl}/markdown`)).text());
  await fixture(request, "invalidate");
  expect(await (await readMarkdown(reportUrl)).text()).toContain("Status: historical evidence.");
  expect(await (await readMarkdown("/")).text()).not.toContain(reportUrl);
  expect((await readMarkdown("/reports/not-an-id")).status()).toBe(404);
  expect((await readMarkdown("/reports/00000000-0000-4000-8000-000000000001")).status()).toBe(404);
  expect((await readMarkdown("/not-a-page")).status()).toBe(404);
  expect((await request.post("/index.md")).status()).toBe(405);
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
});
