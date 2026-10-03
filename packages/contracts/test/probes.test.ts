import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ProbeInput, parseProbeCheckpoint, probeInputSchema } from "../src/probes.js";

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
