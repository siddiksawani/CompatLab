import { describe, expect, it } from "vitest";
import {
  type CompatibilityEvidence,
  compatibilityDescription,
  compatibilityScope,
  omittedCoverage,
  plannedCoverageSummary,
  runtimeAnswers,
} from "../src/server/compatibility-copy.js";

function evidence(): CompatibilityEvidence {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    artifact: { name: "@fixture/package", version: "1.0.0" },
    matrix: {
      images: [
        { kind: "node", profileId: "node-one", version: "24.0.0" },
        { kind: "node", profileId: "node-two", version: "26.0.0" },
        { kind: "bun", profileId: "bun", version: "1.0.0" },
      ],
    },
    coverageComplete: true,
    preparation: { outcome: "pass" },
    cells: ["node-one", "node-two", "bun"].map((profileId) => ({
      profileId,
      group: "root",
      mode: "esm",
      outcome: "pass",
      failure: null,
      coverage: {
        passed: 1,
        failed: 0,
        planned: 1,
        observed: 1,
        interrupted: 0,
        untested: 0,
        complete: true,
      },
    })),
  };
}

describe("evidence-based compatibility answers", () => {
  it("explains omitted exports without inventing missing planned observations", () => {
    const report = evidence();
    report.coverageComplete = false;
    report.omissions = {
      counts: {
        pattern: 1,
        invalid_subpath: 0,
        coverage_limit: 0,
        non_executable: 1,
        not_exported: 1,
      },
      samples: [
        { subpath: "./locales/*", reason: "pattern" },
        { subpath: "./package.json", reason: "non_executable" },
        { subpath: "./private", reason: "not_exported" },
      ],
    };
    expect(plannedCoverageSummary(report)).toBe(
      "All applicable planned checks completed, but some public exports were not included in the plan.",
    );
    expect(omittedCoverage(report)).toEqual({
      count: 1,
      samples: [
        {
          subpath: "./locales/*",
          explanation: "Wildcard export pattern; matching imports were not enumerated",
        },
      ],
    });
    const firstCell = report.cells[0];
    if (!firstCell) throw new Error("Expected a planned cell.");
    firstCell.coverage.complete = false;
    expect(plannedCoverageSummary(report)).toContain("incomplete or unavailable");
    report.omissions.counts.pattern = 0;
    expect(omittedCoverage(report)).toBeNull();
    delete report.omissions;
    expect(omittedCoverage(report)).toBeNull();
  });

  it("uses actual pins, keeps multiple Node profiles and never invents an absent runtime", () => {
    const report = evidence();
    const answers = runtimeAnswers(report);
    expect(answers.map((answer) => answer.kind)).toEqual(["node", "bun"]);
    expect(answers[0]?.results.map((result) => result.runtime)).toEqual([
      "Node.js 24.0.0",
      "Node.js 26.0.0",
    ]);
    expect(answers[1]?.question).toBe("Does @fixture/package work with Bun?");
    expect(answers[1]?.results[0]?.answer).toBe(
      "@fixture/package@1.0.0 passed the applicable loading checks in Bun 1.0.0.",
    );
    expect(compatibilityDescription(report)).not.toContain("Deno");
    expect(compatibilityScope(report)).toContain(
      "does not prove that package functions, native features or your application work",
    );
  });

  it("keeps missing optional peers separate from failures and omitted coverage", () => {
    const report = evidence();
    const cell = report.cells[2];
    if (!cell) throw new Error("Missing fixture cell");
    cell.outcome = "inconclusive";
    cell.coverage = {
      planned: 3,
      observed: 3,
      passed: 1,
      failed: 2,
      prerequisiteLimited: 1,
      interrupted: 0,
      untested: 0,
      complete: true,
    };
    cell.failure = {
      classification: "optional_peer_missing",
      origin: "prerequisite",
      phase: "module_resolution",
      source: "captured_error_code",
      retryable: false,
      message: "Authored missing peer",
      optionalPeer: { name: "renderer", range: "^1" },
    };
    const result = runtimeAnswers(report)[1]?.results[0];
    expect(result?.counts).toBe("1 passed · 1 failed · 1 needs an optional peer");
    expect(result?.answer).toContain("inconclusive loading evidence");
    expect(result?.failures[0]?.path).toBe(`/reports/${report.id}#bun-root-esm`);
    report.coverageComplete = false;
    expect(compatibilityScope(report)).toContain(
      "A passing runtime row does not remove those gaps",
    );
    expect(compatibilityDescription(report)).toContain("not a full compatibility verdict");
  });

  it("separates batch failures after an earlier failure from attributed failures", () => {
    const report = evidence();
    for (const cell of report.cells.slice(0, 2)) {
      cell.group = "subpaths";
      cell.outcome = "inconclusive";
      cell.coverage = {
        planned: 3,
        observed: 3,
        passed: 0,
        failed: 3,
        prerequisiteLimited: 1,
        isolationPassed: 1,
        isolationUnconfirmed: cell.profileId === "node-one" ? 1 : 0,
        interrupted: 0,
        untested: 0,
        complete: true,
      };
    }
    expect(runtimeAnswers(report)[0]?.results.map((result) => result.counts)).toEqual([
      "0 passed · 0 failed · 1 needs an optional peer · 1 failed only in the shared batch · 1 batch failure unconfirmed",
      "0 passed · 1 failed · 1 needs an optional peer · 1 failed only in the shared batch",
    ]);
  });

  it("does not turn missing cells or preparation errors into runtime incompatibility", () => {
    const report = evidence();
    report.cells = [];
    report.coverageComplete = false;
    report.preparation.outcome = "unsupported";
    expect(
      runtimeAnswers(report).every(({ results }) =>
        results.every((result) => result.outcome === "inconclusive"),
      ),
    ).toBe(true);
    expect(compatibilityScope(report)).toContain(
      "Runtime support cannot be inferred from a preparation problem",
    );
  });
});
