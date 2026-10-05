import { describe, expect, it } from "vitest";
import { coverageSummary } from "../src/components/labels.js";
import { markdownPath, prefersMarkdown } from "../src/server/content-discovery.js";
import { publicOpenApi } from "../src/server/openapi.js";

describe("content negotiation", () => {
  it.each([
    [null, false],
    ["*/*", false],
    ["text/*", false],
    ["text/markdown", true],
    ["text/markdown, */*", true],
    ["TEXT/MARKDOWN;q=1, text/html;q=0.5", true],
    ["text/markdown;q=0, text/html", false],
    ["text/html, text/markdown", false],
    ["text/markdown;q=0.5, text/html", false],
    ["text/markdown;q=invalid", false],
    ["text/markdown;q=2", false],
    ["text/markdown;q=0.7, text/html;q=0, */*;q=1", true],
    ["text/markdown;q=0.7, text/*;q=0.8", false],
  ])("negotiates %s as Markdown: %s", (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });
  it("only negotiates pages with a matching representation", () => {
    expect(markdownPath("/")).toBe("/index.md");
    expect(markdownPath("/reports/example")).toBe("/reports/example/markdown");
    for (const path of ["/methodology", "/api/v1/scans", "/reports/example/markdown", "/missing"])
      expect(markdownPath(path)).toBeNull();
  });
});

it("separates mixed outcomes from incomplete coverage", () => {
  const complete = {
    planned: 14,
    observed: 14,
    passed: 12,
    failed: 2,
    interrupted: 0,
    untested: 0,
    complete: true,
  };
  expect(coverageSummary(complete)).toBe("12 passed · 2 failed");
  expect(
    coverageSummary({
      ...complete,
      observed: 12,
      passed: 11,
      failed: 0,
      interrupted: 1,
      untested: 2,
      complete: false,
    }),
  ).toBe("11 passed · 0 failed · 1 interrupted · 2 untested");
  expect(coverageSummary({ ...complete, planned: null, untested: null, complete: false })).toBe(
    "12 passed · 2 failed · coverage limited",
  );
});

it("publishes anonymous read operations with schemas from the contracts", () => {
  const api = publicOpenApi("https://compatlab.me");
  expect(api.security).toEqual([]);
  expect(Object.values(api.paths).every((path) => Object.keys(path).join() === "get")).toBe(true);
  expect(api.components.schemas.ReportEnvelope.properties?.report).toBeDefined();
  expect(api.components.schemas.PackageResponse.properties?.versionsTruncated).toBeDefined();
  expect(JSON.stringify(api)).not.toMatch(/localhost|127\.0\.0\.1|PLACEHOLDER/);
});
