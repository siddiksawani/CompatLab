import { expect, test } from "@playwright/test";
import {
  type BrowserActivity,
  browserActivitySchema,
} from "../../packages/contracts/dist/index.js";
import { finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});
test("browser actions send only fixed categories and do not start work", async ({
  page,
  request,
}) => {
  const signals: BrowserActivity[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "doNotTrack", { value: "0", configurable: true });
    Object.defineProperty(navigator, "globalPrivacyControl", { value: false, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
  });
  await page.route("**/api/v1/browser-activity", async (route) => {
    signals.push(browserActivitySchema.parse(route.request().postDataJSON()));
    expect(route.request().headers().cookie).toBeUndefined();
    expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ status: 204 });
  });
  const saw = (action: string, pageType: string) =>
    signals.some(
      (s) =>
        s.research &&
        s.page === pageType &&
        s.actions.includes(action as BrowserActivity["actions"][number]),
    );
  await page.goto("/?research=1", {
    referer: "https://github.com/private/project?token=not-for-telemetry",
  });
  await expect.poll(() => saw("page_view", "home")).toBe(true);
  expect(signals[0]?.source).toBe("github");
  await page
    .getByRole("searchbox", { name: "Search npm packages" })
    .fill("compatlab-browser-fixture");
  await expect(page.locator(".search-results")).toContainText("compatlab-browser-fixture");
  await expect.poll(() => saw("search", "home")).toBe(true);
  await page.goto("/packages?name=compatlab-browser-fixture&version=1.0.0&research=1");
  await page.getByLabel("Exact version", { exact: true }).selectOption("2.0.0");
  await page.getByRole("button", { name: "Select version", exact: true }).click();
  await expect(page).toHaveURL(/version=2.0.0/);
  await expect.poll(() => saw("version_selected", "package")).toBe(true);
  expect(await (await fixture(request, "counts")).json()).toEqual({ scans: 0, jobs: 0 });
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  const reportPath = new URL(page.url()).pathname;
  const before = await (await fixture(request, "counts")).json();
  await page.goto(`${reportPath}?research=1`);
  await expect.poll(() => saw("evidence_opened", "report")).toBe(true);
  await page.getByRole("button", { name: "Copy report link", exact: true }).click();
  await expect(page.getByText("Copied.", { exact: true })).toBeVisible();
  await expect.poll(() => saw("share_copied", "report")).toBe(true);
  const serialized = JSON.stringify(signals);
  expect(serialized).not.toContain("compatlab-browser-fixture");
  expect(serialized).not.toContain(reportPath);
  expect(serialized).not.toContain("not-for-telemetry");
  expect(signals.every((signal) => signal.automated)).toBe(true);
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
});
test("privacy preferences suppress signals and failed measurement does not block navigation", async ({
  page,
}) => {
  const signals: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
  });
  await page.route("**/api/v1/browser-activity", async (route) => {
    signals.push(route.request().url());
    await route.abort();
  });
  await page.goto("/");
  await page
    .getByRole("searchbox", { name: "Search npm packages" })
    .fill("compatlab-browser-fixture");
  await expect(page.locator(".search-results")).toContainText("compatlab-browser-fixture");
  expect(signals).toEqual([]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "globalPrivacyControl", { value: false, configurable: true }),
  );
  await page.getByRole("searchbox", { name: "Search npm packages" }).fill("browser-fixture");
  await expect.poll(() => signals.length).toBeGreaterThan(0);
  await page.locator(".search-results li > a:first-child").first().click();
  await expect(
    page.getByRole("heading", { name: "compatlab-browser-fixture", exact: true }),
  ).toBeVisible();
});
