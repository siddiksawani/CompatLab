import { describe, expect, it } from "vitest";
import { evaluateCompletion, harnessCompletionSchema, MAX_COMPLETION_BYTES } from "../src/index.js";

const probeId = "50354f76-28d6-4ea7-a223-e462ca6b0f17";
const completion = {
  schemaVersion: 1,
  probeId,
  mode: "esm",
  completed: true,
  outcome: "pass",
  durationMs: 12.5,
};

function evaluate(fileContents: Uint8Array | null, exitCode: number | null = 0) {
  return evaluateCompletion({
    fileContents,
    exitCode,
    expectedProbeId: probeId,
    expectedMode: "esm",
  });
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("harness completion boundary", () => {
  it("accepts a completed observation for the expected probe", () => {
    expect(evaluate(encode(completion))).toEqual({ accepted: true, observation: completion });
  });

  it("preserves an observed module failure when the harness exits successfully", () => {
    const failure = {
      ...completion,
      outcome: "fail",
      error: { name: "Error", message: "Module evaluation failed" },
    };
    expect(evaluate(encode(failure))).toEqual({ accepted: true, observation: failure });
  });

  it.each([null, new Uint8Array()])("rejects exit zero without a result file", (contents) => {
    expect(evaluate(contents)).toMatchObject({
      accepted: false,
      classification: "harness_protocol_error",
    });
  });

  it.each([1, 137, null])("rejects a pass file after unsuccessful termination (%s)", (exitCode) => {
    expect(evaluate(encode(completion), exitCode)).toMatchObject({
      accepted: false,
      classification: "unexpected_process_exit",
    });
  });

  it.each([
    { schemaVersion: 2 },
    { probeId: "65396fa9-6b15-451f-80e3-6924c9d87429" },
    { mode: "commonjs" },
    { completed: false },
    { durationMs: -1 },
    { durationMs: 1e100 },
    { outcome: "probe_verified" },
    { error: { name: "Error", message: "A pass cannot carry a failure" } },
    { unexpectedField: "ignored fields could hide incompatible protocols" },
  ])("rejects incompatible, mismatched or inconsistent data: %j", (change) => {
    expect(evaluate(encode({ ...completion, ...change })).accepted).toBe(false);
  });

  it.each([Buffer.from("not json"), Buffer.from([0xff, 0xfe]), encode(null), encode([])])(
    "rejects malformed input without throwing",
    (input) => {
      expect(evaluate(input)).toMatchObject({ accepted: false });
    },
  );

  it("checks byte limits before parsing", () => {
    const file = Buffer.concat([encode(completion), Buffer.alloc(MAX_COMPLETION_BYTES, " ")]);
    expect(evaluate(file)).toMatchObject({
      accepted: false,
      reason: "The completion file exceeds the byte limit.",
    });
  });

  it("requires bounded error evidence for a failed observation", () => {
    expect(harnessCompletionSchema.safeParse({ ...completion, outcome: "fail" }).success).toBe(
      false,
    );
    expect(
      harnessCompletionSchema.safeParse({
        ...completion,
        outcome: "fail",
        error: { name: "Error", message: "x".repeat(4097) },
      }).success,
    ).toBe(false);
  });
});
