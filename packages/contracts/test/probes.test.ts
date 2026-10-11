import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ProbeInput,
  parseProbeCheckpoint,
  probeGroupResultSchema,
  probeInputSchema,
} from "../src/probes.js";

const input: ProbeInput = {
  schemaVersion: 2,
  probeId: randomUUID(),
  mode: "esm",
  group: "subpaths",
  entries: ["fixture/a", "fixture/b"],
  startIndex: 0,
};
const checkpoint = {
  schemaVersion: 2,
  probeId: input.probeId,
  mode: input.mode,
  group: input.group,
  completed: false,
  activeIndex: 1,
  observations: [
    { index: 0, outcome: "pass", durationMs: 1, valueType: "object", resolvedTo: null },
  ],
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
describe("probe checkpoints", () => {
  it("accepts ordered observations without mistaking them for completion", () => {
    expect(parseProbeCheckpoint(bytes(checkpoint), input).completed).toBe(false);
  });
  it.each([
    { probeId: randomUUID() },
    { mode: "commonjs" },
    { group: "root" },
    { completed: true },
    { activeIndex: 0 },
    { activeIndex: 2 },
    { observations: [{ ...checkpoint.observations[0], index: 1 }] },
    {
      observations: [
        {
          index: 0,
          outcome: "fail",
          resolvedTo: null,
          durationMs: 1,
          error: { name: "Error", message: "x".repeat(2049), code: null },
        },
      ],
    },
  ])("rejects inconsistent progress %j", (change) => {
    expect(() => parseProbeCheckpoint(bytes({ ...checkpoint, ...change }), input)).toThrow();
  });
  it("bounds bytes, structure and encoding before accepting a result", () => {
    for (const value of [
      Buffer.alloc(2 * 1024 ** 2 + 1),
      Buffer.from("[".repeat(10)),
      Buffer.from([0xff]),
      Buffer.from("{"),
    ])
      expect(() => parseProbeCheckpoint(value, input)).toThrow();
  });
  it("rejects arbitrary paths, duplicate-root work and out-of-range resumes", () => {
    for (const change of [
      { entries: ["/etc/passwd"] },
      { entries: ["fixture/../escape"] },
      { entries: ["node:fs"] },
      { group: "root" },
      { startIndex: 2 },
    ])
      expect(probeInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
    expect(
      probeInputSchema.safeParse({ ...input, entries: ["@scope/fixture/subpath"] }).success,
    ).toBe(true);
  });
});
describe("fresh-process confirmations", () => {
  const session = {
    probeId: input.probeId,
    startIndex: 0,
    stopReason: "completed",
    exitCode: 0,
    oomKilled: false,
    durationMs: 1,
    checkpoint: null,
    logs: {
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      emittedBytes: 0,
    },
  };
  const result = {
    profileId: "node_24_21_0",
    group: "subpaths",
    mode: "esm",
    method: "sequential_batch_v2",
    entries: input.entries,
    sessions: [],
    observations: [],
    interruptions: [],
    coverage: { planned: 2, observed: 0, interrupted: 0, untested: 2, complete: false },
  };
  const confirmation = { method: "fresh_entry_v2", index: 1, session };
  it("keeps historical results readable and labels confirmations separately", () => {
    expect(probeGroupResultSchema.parse(result).confirmations).toBeUndefined();
    expect(
      probeGroupResultSchema.parse({ ...result, confirmations: [confirmation] }).confirmations,
    ).toHaveLength(1);
  });
  it.each([
    { confirmations: Array(5).fill(confirmation) },
    { confirmations: [{ ...confirmation, method: "sequential_batch_v2" }] },
    { confirmations: [{ ...confirmation, index: 512 }] },
    { confirmations: [{ ...confirmation, attempt: 2 }] },
  ])("rejects unbounded or relabeled confirmation evidence %#", (change) => {
    expect(probeGroupResultSchema.safeParse({ ...result, ...change }).success).toBe(false);
  });
});
