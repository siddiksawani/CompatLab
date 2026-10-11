import type { ProbeInput, ProbeSession, RuntimeImage } from "@compatlab/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  executePlan,
  planProbes,
  RUNTIME_BASE_IMAGE,
  RUNTIME_SUPPORT_IMAGE,
  runtimeProfile,
} from "../src/index.js";

const profile = runtimeProfile("node_24_21_0");
const image: RuntimeImage = {
  profileId: profile.id,
  kind: profile.kind,
  version: profile.version,
  sourceImage: profile.sourceImage,
  baseImage: RUNTIME_BASE_IMAGE,
  supportImage: RUNTIME_SUPPORT_IMAGE,
  imageId: `sha256:${"a".repeat(64)}`,
  builtAt: "2026-10-03T00:00:00.000Z",
  platform: "linux_amd64_glibc",
  recipeRevision: "runtime_image_v1",
};
function plan(exports: unknown) {
  return planProbes(Buffer.from(JSON.stringify({ name: "fixture", version: "1.0.0", exports })), [
    profile,
  ]);
}
function session(input: ProbeInput, crash: number | null = null): ProbeSession {
  const end = crash ?? input.entries.length;
  return {
    probeId: input.probeId,
    startIndex: input.startIndex,
    stopReason: crash === null ? "completed" : "unexpected_process_exit",
    exitCode: crash === null ? 0 : 1,
    oomKilled: false,
    durationMs: 1,
    logs: {
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      emittedBytes: 0,
    },
    checkpoint: {
      schemaVersion: 2,
      probeId: input.probeId,
      group: input.group,
      mode: input.mode,
      completed: crash === null,
      activeIndex: crash,
      observations: Array.from({ length: end - input.startIndex }, (_, offset) => ({
        index: input.startIndex + offset,
        outcome: "pass",
        valueType: "object",
        resolvedTo: null,
        durationMs: 1,
      })),
    },
  };
}
it("runs root modes in separate jobs and skips empty subpath groups", async () => {
  const run = vi.fn(async (input: ProbeInput) => session(input));
  const result = await executePlan(
    plan("./index.mjs"),
    [image],
    { run },
    new AbortController().signal,
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(new Set(run.mock.calls.map(([input]) => input.probeId)).size).toBe(2);
  expect(result.every((group) => group.coverage.complete)).toBe(true);
});
it("preserves completed entries and resumes after a crash without claiming complete coverage", async () => {
  const run = vi.fn(async (input: ProbeInput) => session(input, input.startIndex === 0 ? 1 : null));
  const result = await executePlan(
    plan({ "./a": "./a.js", "./crash": "./crash.js", "./b": "./b.js" }),
    [image],
    { run },
    new AbortController().signal,
  );
  expect(result[2]?.sessions.map((value) => value.startIndex)).toEqual([0, 2]);
  expect(result[2]?.observations.map((value) => value.index)).toEqual([0, 2]);
  expect(result[2]?.coverage).toEqual({
    planned: 3,
    observed: 2,
    interrupted: 1,
    untested: 0,
    complete: false,
  });
});
it("caps restarts at three and discloses the unattempted remainder", async () => {
  const result = await executePlan(
    plan(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`./${i}`, `./${i}.js`]))),
    [image],
    { run: async (input) => session(input, input.startIndex) },
    new AbortController().signal,
  );
  expect(result[2]?.sessions).toHaveLength(4);
  expect(result[2]?.coverage).toEqual({
    planned: 8,
    observed: 0,
    interrupted: 4,
    untested: 4,
    complete: false,
  });
});
it("stops a malformed batch and does not invent a resume position", async () => {
  const result = await executePlan(
    plan({ "./a": "./a.js", "./b": "./b.js" }),
    [image],
    {
      run: async (input) => ({
        ...session(input),
        checkpoint: null,
        stopReason: "harness_protocol_error",
      }),
    },
    new AbortController().signal,
  );
  expect(result[2]?.sessions).toHaveLength(1);
  expect(result[2]?.coverage.untested).toBe(2);
});
it("keeps cancelled work visibly untested and rejects false backend completion", async () => {
  const run = vi.fn(async (input: ProbeInput) => ({ ...session(input), exitCode: 1 }));
  const input = plan("./index.js");
  expect(
    (await executePlan(input, [image], { run }, AbortSignal.abort()))[0]?.coverage.untested,
  ).toBe(1);
  expect(run).not.toHaveBeenCalled();
  await expect(executePlan(input, [image], { run }, new AbortController().signal)).rejects.toThrow(
    "without valid evidence",
  );
});

it("stops dispatch when bounded evidence exhausts the report budget", async () => {
  const run = vi.fn(async (input: ProbeInput) => ({
    ...session(input),
    logs: { ...session(input).logs, stdout: "x".repeat(2048) },
  }));
  await expect(
    executePlan(plan("./index.js"), [image], { run }, new AbortController().signal, 1024),
  ).rejects.toThrow("evidence byte limit");
  expect(run).toHaveBeenCalledTimes(1);
});

it("limits total retained logs across variable runtime matrices", async () => {
  const profiles = Array.from({ length: 12 }, (_, i) => ({ ...profile, id: `fixture_${i}` }));
  const images = profiles.map((value, i) => ({
    ...image,
    profileId: value.id,
    imageId: `sha256:${i.toString(16).padStart(64, "0")}`,
  }));
  const input = planProbes(
    Buffer.from(JSON.stringify({ name: "fixture", version: "1.0.0", main: "index.js" })),
    profiles,
  );
  const result = await executePlan(
    input,
    images,
    {
      run: async (input) => ({
        ...session(input),
        logs: {
          stdout: "λ".repeat(64 * 1024),
          stderr: "x".repeat(128 * 1024),
          stdoutTruncated: false,
          stderrTruncated: false,
          emittedBytes: 256 * 1024,
        },
      }),
    },
    new AbortController().signal,
  );
  expect(
    result
      .flatMap((group) => group.sessions)
      .reduce(
        (sum, session) =>
          sum + Buffer.byteLength(session.logs.stdout) + Buffer.byteLength(session.logs.stderr),
        0,
      ),
  ).toBe(4 * 1024 ** 2);
  expect(result.at(-3)?.sessions[0]?.logs.stdoutTruncated).toBe(true);
});

const missingPeer = {
  name: "Error",
  message: "Cannot find package 'vitest' imported from /workspace/node_modules/fixture/test.js",
  code: "ERR_MODULE_NOT_FOUND",
};
const raceCondition = {
  name: "Error",
  message: "Cannot require() ES Module fixture/db.js in a cycle.",
  code: "ERR_REQUIRE_ESM_RACE_CONDITION",
};
const helperFirst = plan({
  "./test": "./test.js",
  "./db/adapter": "./adapter.js",
  "./db/migration": "./migration.js",
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`./extra/${i}`, `./${i}.js`])),
});
// The helper misses its optional peer; later loads fail only in a process that saw a failure.
function sharedProcess(stillFailing: readonly string[] = [], fresh?: typeof session) {
  return vi.fn(async (input: ProbeInput): Promise<ProbeSession> => {
    if (fresh && input.group === "subpaths" && input.entries.length === 1) return fresh(input);
    const value = session(input);
    let failed = false;
    if (value.checkpoint)
      value.checkpoint.observations = value.checkpoint.observations.map((observation) => {
        const specifier = input.entries[observation.index] ?? "";
        const error = specifier.endsWith("/test")
          ? missingPeer
          : failed || stillFailing.includes(specifier)
            ? raceCondition
            : null;
        if (!error) return observation;
        failed = true;
        return {
          index: observation.index,
          outcome: "fail",
          resolvedTo: null,
          durationMs: 1,
          error,
        };
      });
    return value;
  });
}
const confirmationInputs = (run: ReturnType<typeof sharedProcess>) =>
  run.mock.calls.map(([input]) => input).filter((input) => input.entries.length === 1);

describe("fresh-process confirmation after an earlier failed batch load", () => {
  it("confirms later failures in fresh sessions without changing batch evidence", async () => {
    const run = sharedProcess();
    const result = await executePlan(
      plan({ "./test": "./test.js", "./db/adapter": "./a.js", "./db/migration": "./m.js" }),
      [image],
      { run },
      new AbortController().signal,
    );
    for (const group of [result[2], result[3]]) {
      expect(group?.method).toBe("sequential_batch_v2");
      expect(group?.observations.map((value) => value.outcome)).toEqual(["fail", "fail", "fail"]);
      expect(group?.coverage).toMatchObject({ observed: 3, complete: true });
      expect(group?.sessions).toHaveLength(1);
      expect(
        group?.confirmations?.map(({ method, index, session }) => [
          method,
          index,
          session.stopReason,
          session.checkpoint?.observations[0]?.outcome,
        ]),
      ).toEqual([
        ["fresh_entry_v2", 1, "completed", "pass"],
        ["fresh_entry_v2", 2, "completed", "pass"],
      ]);
    }
    expect(result[0]?.confirmations).toBeUndefined();
    expect(confirmationInputs(run).map((input) => [input.entries, input.startIndex])).toEqual([
      [["fixture/db/adapter"], 0],
      [["fixture/db/migration"], 0],
      [["fixture/db/adapter"], 0],
      [["fixture/db/migration"], 0],
    ]);
    expect(new Set(run.mock.calls.map(([input]) => input.probeId)).size).toBe(6);
  });

  it("records a fresh failure and confirms at most four entries per group", async () => {
    const run = sharedProcess(["fixture/db/migration"]);
    const result = await executePlan(helperFirst, [image], { run }, new AbortController().signal);
    for (const group of [result[2], result[3]]) {
      expect(group?.observations.filter((value) => value.outcome === "fail")).toHaveLength(9);
      expect(group?.confirmations?.map((value) => value.index)).toEqual([1, 2, 3, 4]);
      expect(
        group?.confirmations?.map((value) => value.session.checkpoint?.observations[0]?.outcome),
      ).toEqual(["pass", "fail", "pass", "pass"]);
    }
    expect(confirmationInputs(run)).toHaveLength(8);
  });

  it("does not retry interrupted confirmations and stops confirming after cancellation", async () => {
    const controller = new AbortController();
    const run = sharedProcess([], (input) => {
      if (input.mode === "commonjs") controller.abort();
      return {
        ...session(input, 0),
        stopReason: input.mode === "esm" ? "entry_timeout" : "cancelled",
        exitCode: null,
      };
    });
    const result = await executePlan(helperFirst, [image], { run }, controller.signal);
    expect(result[2]?.confirmations?.map((value) => value.session.stopReason)).toEqual(
      Array(4).fill("entry_timeout"),
    );
    expect(result[3]?.confirmations?.map((value) => value.session.stopReason)).toEqual([
      "cancelled",
    ]);
    expect(confirmationInputs(run).map((input) => input.entries[0])).toEqual([
      "fixture/db/adapter",
      "fixture/db/migration",
      "fixture/extra/0",
      "fixture/extra/1",
      "fixture/db/adapter",
    ]);
  });

  it("omits a confirmation that would exceed the evidence budget and keeps the batch", async () => {
    // A dropped confirmation must return its log share, or the next one would fit as empty logs.
    const run = sharedProcess([], (input) => ({
      ...session(input),
      logs: { ...session(input).logs, stdout: "x".repeat(4 * 1024 ** 2) },
    }));
    const result = await executePlan(
      helperFirst,
      [image],
      { run },
      new AbortController().signal,
      100_000,
    );
    expect(result[2]?.observations).toHaveLength(9);
    expect(result[2]?.confirmations).toBeUndefined();
    expect(result[3]?.confirmations).toBeUndefined();
    expect(confirmationInputs(run)).toHaveLength(2);
  });
});
