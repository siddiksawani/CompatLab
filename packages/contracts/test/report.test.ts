import { describe, expect, it } from "vitest";
import { normalizedFailureSchema, reportCellSchema, reportCoverageSchema } from "../src/report.js";

const failure = {
  classification: "optional_peer_missing",
  phase: "module_resolution",
  origin: "prerequisite",
  retryable: false,
  source: "captured_error_code",
  message: "Cannot find module 'renderer'",
  optionalPeer: { name: "renderer", range: "^2" },
};
const coverage = {
  planned: 3,
  observed: 3,
  passed: 1,
  failed: 2,
  interrupted: 0,
  untested: 0,
  complete: true,
};

describe("optional-peer report contracts", () => {
  it("keeps legacy coverage and failures readable without the new fields", () => {
    expect(reportCoverageSchema.parse(coverage)).toEqual(coverage);
    const { optionalPeer: _, ...legacy } = failure;
    expect(
      normalizedFailureSchema.safeParse({
        ...legacy,
        classification: "package_resolution_failed",
        origin: "package",
      }).success,
    ).toBe(true);
  });

  it("keeps prerequisite-limited attempts within the raw failure count", () => {
    expect(reportCoverageSchema.parse({ ...coverage, prerequisiteLimited: 1 }).failed).toBe(2);
    expect(reportCoverageSchema.safeParse({ ...coverage, prerequisiteLimited: 3 }).success).toBe(
      false,
    );
  });

  it("keeps explained subsets within the raw failure count", () => {
    const explained = { ...coverage, prerequisiteLimited: 1, isolationPassed: 1 };
    expect(reportCoverageSchema.parse(explained).failed).toBe(2);
    expect(reportCoverageSchema.safeParse({ ...explained, isolationUnconfirmed: 1 }).success).toBe(
      false,
    );
  });

  it("requires an isolation record to follow an earlier failed entry", () => {
    const entries = reportCellSchema.shape.entries;
    const isolated = {
      index: 2,
      specifier: "fixture/db",
      displaySpecifier: "fixture/db",
      outcome: "inconclusive",
      durationMs: 1,
      resolvedTo: null,
      failure: null,
      isolation: {
        priorFailureIndex: 1,
        batchFailure: {
          classification: "commonjs_require_failed",
          phase: "module_evaluation",
          origin: "package",
          retryable: false,
          source: "harness_observation",
          message: "Cannot require() ES Module fixture/db.js in a cycle.",
        },
        confirmation: null,
      },
    };
    expect(entries.parse([isolated])[0]?.isolation?.priorFailureIndex).toBe(1);
    for (const priorFailureIndex of [2, 3])
      expect(
        entries.safeParse([
          { ...isolated, isolation: { ...isolated.isolation, priorFailureIndex } },
        ]).success,
      ).toBe(false);
  });

  it("requires corroborating context for the prerequisite classification", () => {
    expect(normalizedFailureSchema.parse(failure)).toEqual(failure);
    for (const change of [
      { optionalPeer: undefined },
      { origin: "package" },
      { phase: "module_evaluation" },
      { retryable: true },
      { classification: "esm_import_failed" },
    ])
      expect(normalizedFailureSchema.safeParse({ ...failure, ...change }).success).toBe(false);
  });
});
