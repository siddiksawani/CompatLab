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
  confirmationCandidates,
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
      coverage: {
        passed: 1,
        failed: 2,
        prerequisiteLimited: 1,
        isolationUnconfirmed: 1,
        observed: 3,
        complete: true,
      },
    });
    expect(result.entries.map((entry) => entry.outcome)).toEqual([
      "pass",
      "inconclusive",
      "inconclusive",
    ]);
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
const raceCondition = {
  name: "Error",
  message: "Cannot require() ES Module fixture/db.js in a cycle.",
  code: "ERR_REQUIRE_ESM_RACE_CONDITION",
};
const vitest = optionalPeerContext(
  "fixture",
  {
    name: "fixture",
    peerDependencies: { vitest: "^3" },
    peerDependenciesMeta: { vitest: { optional: true } },
  },
  ["node_modules/fixture"],
);
function failWith(
  evidence: ProbeGroupResult,
  index: number,
  error: Extract<LoadObservation, { outcome: "fail" }>["error"],
) {
  const observation = evidence.observations[index];
  if (observation?.outcome !== "fail") throw new Error("Fixture failure missing.");
  observation.error = error;
}
function helperFirst() {
  const evidence = group(["fail", "fail", "fail", "fail"]);
  failWith(evidence, 0, {
    name: "Error",
    message: "Cannot find package 'vitest' imported from /workspace/node_modules/fixture/test.js",
    code: "ERR_MODULE_NOT_FOUND",
  });
  for (const index of [1, 2, 3]) failWith(evidence, index, raceCondition);
  return evidence;
}
function confirm(
  evidence: ProbeGroupResult,
  index: number,
  result: "pass" | "fail" | "entry_timeout",
) {
  const probeId = randomUUID();
  const completed = result !== "entry_timeout";
  const observation: LoadObservation =
    result === "fail"
      ? {
          index: 0,
          outcome: "fail",
          resolvedTo: null,
          durationMs: 1,
          error: { name: "Error", message: "Fails in a fresh process", code: null },
        }
      : { index: 0, outcome: "pass", resolvedTo: null, durationMs: 1, valueType: "object" };
  evidence.confirmations = [
    ...(evidence.confirmations ?? []),
    {
      method: "fresh_entry_v2",
      index,
      session: {
        probeId,
        startIndex: 0,
        stopReason: completed ? "completed" : "entry_timeout",
        exitCode: completed ? 0 : null,
        oomKilled: false,
        durationMs: 3,
        checkpoint: {
          schemaVersion: 2,
          probeId,
          group: "subpaths",
          mode: "esm",
          completed,
          activeIndex: completed ? null : 0,
          observations: completed ? [observation] : [],
        },
        logs: {
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          emittedBytes: 0,
        },
      },
    },
  ];
}
describe("failures after an earlier failed load in the same batch process", () => {
  it("keeps historical unconfirmed failures inconclusive without inventing confirmations", () => {
    const evidence = helperFirst();
    const original = structuredClone(evidence);
    const result = cell(evidence, vitest);
    expect(result).toMatchObject({
      method: "sequential_batch_v2",
      outcome: "inconclusive",
      failure: { classification: "optional_peer_missing" },
      coverage: {
        observed: 4,
        passed: 0,
        failed: 4,
        prerequisiteLimited: 1,
        isolationPassed: 0,
        isolationUnconfirmed: 3,
        complete: true,
      },
    });
    expect(result.entries.map((entry) => entry.outcome)).toEqual(Array(4).fill("inconclusive"));
    expect(result.entries[0]?.isolation).toBeUndefined();
    expect(result.entries[1]).toMatchObject({
      failure: null,
      isolation: {
        priorFailureIndex: 0,
        batchFailure: { classification: "esm_import_failed", message: raceCondition.message },
        confirmation: null,
      },
    });
    expect(evidence).toEqual(original);
  });
  it("uses bounded fresh-process confirmations without changing raw counts", () => {
    const evidence = helperFirst();
    confirm(evidence, 1, "pass");
    confirm(evidence, 2, "fail");
    confirm(evidence, 3, "entry_timeout");
    const original = structuredClone(evidence);
    const result = cell(evidence, vitest);
    expect(result.entries.map((entry) => entry.outcome)).toEqual([
      "inconclusive",
      "pass",
      "fail",
      "inconclusive",
    ]);
    expect(result.coverage).toMatchObject({
      passed: 0,
      failed: 4,
      prerequisiteLimited: 1,
      isolationPassed: 1,
      isolationUnconfirmed: 1,
    });
    expect(result.entries[1]).toMatchObject({
      failure: null,
      isolation: { confirmation: { method: "fresh_entry_v2", stopReason: "completed" } },
    });
    expect(result.entries[2]?.failure).toMatchObject({
      classification: "esm_import_failed",
      origin: "package",
      message: "Fails in a fresh process",
    });
    expect(result.entries[3]).toMatchObject({
      failure: null,
      isolation: { confirmation: { stopReason: "entry_timeout" } },
    });
    expect(evidence).toEqual(original);
  });
  it("credits a fresh-process pass while keeping the first batch failure", () => {
    const evidence = group(["pass", "fail", "fail"]);
    failWith(evidence, 2, raceCondition);
    confirm(evidence, 2, "pass");
    expect(cell(evidence).entries.map((entry) => entry.outcome)).toEqual(["pass", "fail", "pass"]);
    expect(cell(evidence).outcome).toBe("partial");
  });
  it("confirms recognized codes and keeps optional peers attributed as observed", () => {
    const evidence = group(["fail", "fail", "fail", "fail"]);
    const addon = {
      name: "Error",
      message: "Module did not self-register: '/workspace/node_modules/fixture/addon.node'.",
      code: "ERR_DLOPEN_FAILED",
    };
    failWith(evidence, 1, addon);
    failWith(evidence, 2, addon);
    failWith(evidence, 3, { name: "Error", message: 'missing "vitest" dependency.', code: null });
    confirm(evidence, 1, "fail");
    const result = cell(evidence, vitest);
    expect(result.entries.map((entry) => entry.outcome)).toEqual([
      "fail",
      "fail",
      "inconclusive",
      "inconclusive",
    ]);
    expect(result.entries[1]?.failure?.message).toBe("Fails in a fresh process");
    expect(result.entries[2]).toMatchObject({
      failure: null,
      isolation: {
        batchFailure: { classification: "native_addon_load_failed" },
        confirmation: null,
      },
    });
    expect(result.entries[3]?.isolation).toBeUndefined();
    expect(result.entries[3]?.failure?.classification).toBe("optional_peer_missing");
    expect(result.coverage).toMatchObject({
      failed: 4,
      prerequisiteLimited: 1,
      isolationPassed: 0,
      isolationUnconfirmed: 1,
    });
  });
  it("selects candidates only within one process session", () => {
    const evidence = group(["fail", "fail", "fail", "fail"]);
    const [first] = evidence.sessions;
    if (!first?.checkpoint) throw new Error("Fixture session missing.");
    const second = structuredClone(first);
    second.probeId = randomUUID();
    second.startIndex = 2;
    if (!second.checkpoint) throw new Error("Fixture session missing.");
    second.checkpoint.observations = evidence.observations.slice(2);
    first.checkpoint.observations = evidence.observations.slice(0, 1);
    first.stopReason = "unexpected_process_exit";
    evidence.sessions.push(second);
    expect([...confirmationCandidates(evidence)]).toEqual([[3, 2]]);
    expect(confirmationCandidates({ ...evidence, group: "root" }).size).toBe(0);
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
