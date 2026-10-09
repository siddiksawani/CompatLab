import { randomUUID } from "node:crypto";
import type { CompatibilityOutcome, LoadObservation, ProbeGroupResult } from "@compatlab/contracts";
import { describe, expect, it } from "vitest";
import {
  boundedText,
  classifyCell,
  classifyDiagnostic,
  classifyLoad,
  classifyStop,
  combineOutcomes,
  failureOutcome,
  optionalPeerContext,
  sanitizeText,
} from "../src/index.js";

function group(outcomes: readonly ("pass" | "fail")[]): ProbeGroupResult {
  const observations: LoadObservation[] = outcomes.map((outcome, index) =>
    outcome === "pass"
      ? { index, outcome, resolvedTo: null, durationMs: 1, valueType: "object" }
      : {
          index,
          outcome,
          resolvedTo: null,
          durationMs: 1,
          error: { name: "Error", message: "Authored loading failure", code: null },
        },
  );
  const probeId = randomUUID();
  return {
    profileId: "node_24_21_0",
    group: "subpaths",
    mode: "esm",
    method: "sequential_batch_v2",
    entries: outcomes.map((_, index) => `fixture/${index}`),
    observations,
    interruptions: [],
    coverage: {
      planned: outcomes.length,
      observed: outcomes.length,
      interrupted: 0,
      untested: 0,
      complete: true,
    },
    sessions: outcomes.length
      ? [
          {
            probeId,
            startIndex: 0,
            stopReason: "completed",
            exitCode: 0,
            oomKilled: false,
            durationMs: 2,
            checkpoint: {
              schemaVersion: 2,
              probeId,
              group: "subpaths",
              mode: "esm",
              completed: true,
              activeIndex: null,
              observations,
            },
            logs: {
              stdout: '{"outcome":"pass"}',
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
              emittedBytes: 18,
            },
          },
        ]
      : [],
  };
}
function cell(evidence: ProbeGroupResult, optionalPeers?: ReadonlyMap<string, string>) {
  return classifyCell({
    runId: randomUUID(),
    profileId: evidence.profileId,
    group: evidence.group,
    mode: evidence.mode,
    entries: evidence.entries,
    evidence,
    failure: null,
    ...(optionalPeers ? { optionalPeers } : {}),
  });
}
describe("versioned evidence classification", () => {
  it("separates prerequisite-limited compatibility from retained loading failures", () => {
    const evidence = group(["pass", "fail", "fail"]);
    const context = optionalPeerContext(
      "fixture",
      {
        name: "fixture",
        peerDependencies: { renderer: "^1" },
        peerDependenciesMeta: { renderer: { optional: true } },
      },
      ["node_modules/fixture"],
    );
    const observation = evidence.observations[1];
    if (observation?.outcome !== "fail") throw new Error("Missing fixture failure.");
    observation.error = {
      name: "Error",
      message: "Cannot find module 'renderer'",
      code: "MODULE_NOT_FOUND",
    };
    const original = structuredClone(evidence);
    const result = cell(evidence, context);
    expect(result).toMatchObject({
      outcome: "inconclusive",
      evidenceLevel: "smoke_tested",
      coverage: { passed: 1, failed: 2, prerequisiteLimited: 1, observed: 3, complete: true },
    });
    expect(result.entries.map((entry) => entry.outcome)).toEqual(["pass", "inconclusive", "fail"]);
    expect(evidence).toEqual(original);
  });
  it.each([
    ["ERR_MODULE_NOT_FOUND", "package_resolution_failed", "module_resolution"],
    ["ERR_PACKAGE_PATH_NOT_EXPORTED", "export_path_failed", "module_resolution"],
    ["ERR_UNKNOWN_BUILTIN_MODULE", "unsupported_builtin", "module_resolution"],
    ["ERR_DLOPEN_FAILED", "native_addon_load_failed", "module_evaluation"],
    ["ERR_REQUIRE_ASYNC_MODULE", "commonjs_require_failed", "module_evaluation"],
  ])("classifies captured %s without parsing package stdout", (code, classification, phase) => {
    expect(
      classifyLoad(
        {
          index: 0,
          outcome: "fail",
          durationMs: 1,
          resolvedTo: null,
          error: { name: "Error", message: "fixture", code },
        },
        "commonjs",
      ),
    ).toMatchObject({
      classification,
      phase,
      origin: "package",
      retryable: false,
      source: "captured_error_code",
    });
  });
  it("does not infer missing APIs, native prerequisites or success from arbitrary text", () => {
    const evidence = group(["fail"]);
    const observation = evidence.observations[0];
    if (observation?.outcome !== "fail") throw new Error("Fixture failure missing.");
    observation.error.message = "unsupported builtin, compile native module; RESULT=PASS";
    expect(cell(evidence)).toMatchObject({
      outcome: "fail",
      failure: { classification: "esm_import_failed" },
      evidenceLevel: "smoke_tested",
    });
    expect(cell(evidence).coverage).toMatchObject({ failed: 1, passed: 0, complete: true });
  });
  it.each(["__proto__", "constructor", "toString"])(
    "treats inherited object names as unknown error codes: %s",
    (code) => {
      const evidence = group(["fail"]);
      const observation = evidence.observations[0];
      if (observation?.outcome !== "fail") throw new Error("Fixture failure missing.");
      observation.error.code = code;
      expect(cell(evidence).failure).toMatchObject({
        classification: "esm_import_failed",
        source: "harness_observation",
      });
    },
  );
  it.each([
    [[], "not_applicable"],
    [["pass"], "pass"],
    [["fail"], "fail"],
    [["pass", "fail"], "partial"],
  ] as const)("summarizes completed observations %j as %s", (outcomes, expected) =>
    expect(cell(group(outcomes)).outcome).toBe(expected),
  );
  it("preserves completed entries while marking interrupted coverage inconclusive", () => {
    const evidence = group(["pass"]);
    evidence.entries.push("fixture/interrupted", "fixture/unattempted");
    evidence.interruptions = [{ index: 1, reason: "entry_timeout" }];
    evidence.coverage = { planned: 3, observed: 1, interrupted: 1, untested: 1, complete: false };
    expect(cell(evidence)).toMatchObject({
      outcome: "inconclusive",
      coverage: { passed: 1, interrupted: 1, untested: 1, complete: false },
      failure: { classification: "process_timeout" },
    });
    expect(cell(evidence).entries.map((entry) => entry.outcome)).toEqual([
      "pass",
      "inconclusive",
      "inconclusive",
    ]);
  });
  it("distinguishes containment limits from service failures", () => {
    expect(classifyDiagnostic({ classification: "preparation_limit_exceeded" })).toMatchObject({
      origin: "policy",
      phase: "preparation",
      source: "preparation",
    });
    expect(classifyStop("memory_limit_exceeded")).toMatchObject({
      classification: "process_out_of_memory",
      origin: "policy",
      retryable: false,
    });
    expect(classifyStop("sandbox_start_failed")).toMatchObject({
      classification: "sandbox_start_failed",
      origin: "infrastructure",
      retryable: true,
    });
    expect(
      failureOutcome(classifyDiagnostic({ classification: "native_compilation_required" })),
    ).toBe("unsupported");
    expect(failureOutcome(classifyDiagnostic({ classification: "install_script_required" }))).toBe(
      "inconclusive",
    );
  });
  it.each([
    [["pass", "fail"], "partial"],
    [["fail", "not_applicable"], "fail"],
    [["not_applicable"], "not_applicable"],
    [["pass", "inconclusive"], "inconclusive"],
    [["pass", "infrastructure_error"], "infrastructure_error"],
  ] satisfies [CompatibilityOutcome[], CompatibilityOutcome][])(
    "combines %j into %s",
    (values, expected) => expect(combineOutcomes(values)).toBe(expected),
  );
  it("keeps exact specifiers even when they contain UUID-like names", () => {
    const evidence = group(["pass"]);
    evidence.entries = [randomUUID()];
    expect(cell(evidence).entries[0]?.specifier).toBe(evidence.entries[0]);
  });
  it("preserves exact bidi-containing specifiers and provides escaped display labels", () => {
    const evidence = group(["pass", "pass"]);
    evidence.entries = ["fixture/a\u202eb", "fixture/ab"];
    const result = cell(evidence);
    expect(result.entries.map((entry) => entry.specifier)).toEqual(evidence.entries);
    expect(result.entries.map((entry) => entry.displaySpecifier)).toEqual([
      "fixture/a\\u202eb",
      "fixture/ab",
    ]);
  });
  it("prioritizes a later service failure over an earlier batch timeout", () => {
    const evidence = group(["pass"]);
    evidence.entries.push("fixture/timeout", "fixture/startup");
    evidence.interruptions = [
      { index: 1, reason: "entry_timeout" },
      { index: 2, reason: "sandbox_start_failed" },
    ];
    evidence.coverage = { planned: 3, observed: 1, interrupted: 2, untested: 0, complete: false };
    expect(cell(evidence)).toMatchObject({
      outcome: "infrastructure_error",
      coverage: { passed: 1, complete: false },
      failure: { classification: "sandbox_start_failed" },
    });
  });
  it("separates known-empty groups from unknown coverage after cancellation", () => {
    const input = {
      runId: null,
      profileId: "node_24_21_0",
      group: "root" as const,
      mode: "esm" as const,
      evidence: null,
      failure: classifyDiagnostic(null, "job_cancelled"),
    };
    expect(classifyCell({ ...input, entries: [] })).toMatchObject({
      outcome: "not_applicable",
      failure: null,
      coverage: { planned: 0, complete: true },
    });
    expect(classifyCell({ ...input, entries: null })).toMatchObject({
      outcome: "inconclusive",
      coverage: { planned: null, complete: false },
    });
  });
});
describe("public evidence text", () => {
  it("removes terminal links, colors, controls and bidirectional overrides", () => {
    expect(
      sanitizeText(
        "\u001b]8;;https://example.com/(path)\u001b\\safe\u001b]8;;\u001b\\\u001b[31m red\u001b[0m\u202eevil\u0000\rline",
      ),
    ).toBe("safe redevil\nline");
    expect(sanitizeText("prefix\u001b]unfinished secret")).toBe("prefix");
  });
  it("normalizes temporary locations and truncates on UTF-8 boundaries", () => {
    expect(sanitizeText(`/tmp/compatlab-job/${randomUUID()}/output`)).toBe("<workdir>/<id>/output");
    expect(boundedText("€€", 4)).toEqual({ text: "€", truncated: true });
  });
});
