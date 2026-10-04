import { expect, test } from "@playwright/test";
import { finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
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
