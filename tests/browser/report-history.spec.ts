import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, finish, fixture, requestScan } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await fixture(request, "reset");
});

test("reclassification preserves execution time, selected entry and comparison meaning", async ({
  page,
  request,
}) => {
  await requestScan(page, "compatlab-browser-fixture");
  await finish(page, request);
  const { original, replacement, observedAt } = await (
    await fixture(request, "historical-revision")
  ).json();
  const date = `${observedAt.slice(0, 16).replace("T", " ")} UTC`;
  const counts = await (await fixture(request, "counts")).json();
  const selection = "?cell=node_24_21_0-root-esm&entry=0#selected-result";
  await page.goto(`/reports/${original}${selection}`);
  await expect(page.getByText("Historical evidence", { exact: true })).toBeVisible();
  await expect(page.getByText(`Classified ${date} · classifier_v1`)).toBeVisible();
  await page.getByRole("link", { name: "Open the replacement report" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/reports/${replacement}\\?cell=node_24_21_0-root-esm&entry=0#selected-result$`),
  );
  await expect(page.getByRole("region", { name: "Selected import result" })).toContainText(
    `Observed ${date}`,
  );
  await page.getByRole("link", { name: "Report history", exact: true }).click();
  const history = page.getByRole("list", { name: "Recorded reports" });
  await expect(history.getByText(`Executed ${date}`, { exact: false })).toHaveCount(2);
  await history.getByRole("link", { name: "Compare with replacement classification" }).click();
  await expect(page.getByText("Same execution", { exact: true })).toBeVisible();
  await expect(page.getByText("0 meaningful evidence changes.")).toBeVisible();
  await expect(
    page.getByText("No meaningful evidence changes. Timing and log differences are ignored."),
  ).toBeVisible();
  await expect(page.getByText("classifier", { exact: true })).toBeVisible();
  await expectResponsiveLayout(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await (await fixture(request, "counts")).json()).toEqual(counts);
});
