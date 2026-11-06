import { expect, test } from "@playwright/test";
import { finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});
test("shares a burst of delayed report and exact-version reads, then observes invalidation", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  const reportPath = new URL(page.url()).pathname;
  const before = await (await fixture(request, "counts")).json();
  for (const path of [reportPath, "/npm/compatlab-browser-fixture/1.0.0"]) {
    await fixture(request, "hold-reads");
    const responses = await Promise.all(Array.from({ length: 12 }, () => request.get(path)));
    for (const response of responses) {
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain("compatlab-browser-fixture");
    }
  }
  await fixture(request, "invalidate");
  expect((await request.get("/npm/compatlab-browser-fixture/1.0.0")).status()).toBe(404);
  await page.goto(reportPath);
  await expect(page.getByText("Historical evidence", { exact: true })).toBeVisible();
  expect(await (await fixture(request, "counts")).json()).toEqual(before);
});
