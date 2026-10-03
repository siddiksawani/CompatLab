import type { ProbeInput, ProbeSession, RuntimeImage } from "@compatlab/contracts";
import { expect, it, vi } from "vitest";
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
