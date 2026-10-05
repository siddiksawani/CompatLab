import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const longPackageName = `@compatlab/${"browser-layout-".repeat(12)}fixture`;

export async function fixture(request: APIRequestContext, operation: string) {
  const response = await request.post(`http://127.0.0.1:3878/${operation}`, {
    headers: { "x-compatlab-fixture": "browser_v1" },
  });
  expect(response.ok()).toBe(true);
  return response;
}

export async function requestScan(page: Page, name: string, version = "1.0.0") {
  await page.goto(`/packages?${new URLSearchParams({ name, version })}`);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request a scan", exact: true }).click();
  await expect(page).toHaveURL(/\/scans\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "requested", exact: true })).toBeVisible();
}

export async function finish(page: Page, request: APIRequestContext, operation = "execute") {
  await fixture(request, operation);
  await expect(page).toHaveURL(/\/reports\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Runtime matrix", exact: true })).toBeVisible();
}

export async function expectResponsiveLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const content = document.querySelector("main > .page, main > .hero");
    const bounds = content?.getBoundingClientRect();
    const footer = document.querySelector("footer")?.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll("main button, main input:not([type=hidden]), header a"),
    ]
      .filter((element) => element.checkVisibility())
      .map((element) => ({
        text: element.textContent?.trim() || element.id,
        bounds: element.getBoundingClientRect(),
      }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0);
    const overlaps: string[] = [];
    for (const [index, first] of controls.entries()) {
      for (const second of controls.slice(index + 1)) {
        const a = first.bounds,
          b = second.bounds;
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        )
          overlaps.push(`${first.text} / ${second.text}`);
      }
    }
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      left: bounds?.left,
      right: bounds?.right,
      footerBottom: footer ? footer.bottom + scrollY : 0,
      height: innerHeight,
      clippedControls: controls
        .filter(
          ({ bounds }) =>
            bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1,
        )
        .map(({ text }) => text),
      overlaps,
    };
  });
  expect(layout.scrollWidth, page.url()).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.left, page.url()).toBeGreaterThanOrEqual(16);
  expect(layout.right, page.url()).toBeLessThanOrEqual(layout.width - 16);
  expect(
    Math.abs((layout.left ?? 0) - (layout.width - (layout.right ?? 0))),
    page.url(),
  ).toBeLessThanOrEqual(2);
  expect(layout.footerBottom, page.url()).toBeGreaterThanOrEqual(layout.height - 1);
  expect(layout.clippedControls, page.url()).toEqual([]);
  expect(layout.overlaps, page.url()).toEqual([]);
}
