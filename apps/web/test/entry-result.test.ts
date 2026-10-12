import { randomUUID } from "node:crypto";
import type { ProbeGroupResult, ReportCell } from "@compatlab/contracts";
import { describe, expect, it } from "vitest";
import {
  cellAnchor,
  entryPath,
  recordedValueType,
  selectEntry,
} from "../src/components/entry-result";

const entry: ReportCell["entries"][number] = {
  index: 1,
  specifier: "example/server",
  displaySpecifier: "example/server",
  outcome: "pass",
  durationMs: 2,
  resolvedTo: null,
  failure: null,
};
const cell: ReportCell = {
  runId: randomUUID(),
  profileId: "bun_1_4_2",
  group: "subpaths",
  mode: "commonjs",
  method: "sequential_batch_v2",
  outcome: "pass",
  evidenceLevel: "smoke_tested",
  coverage: {
    planned: 2,
    observed: 2,
    passed: 2,
    failed: 0,
    interrupted: 0,
    untested: 0,
    complete: true,
  },
  durationMs: 2,
  failure: null,
  entries: [entry],
  sessions: [],
};
const raw: ProbeGroupResult = {
  profileId: cell.profileId,
  group: cell.group,
  mode: cell.mode,
  method: cell.method,
  entries: ["example/client", entry.specifier],
  sessions: [],
  interruptions: [],
  coverage: { planned: 2, observed: 2, interrupted: 0, untested: 0, complete: true },
  observations: [
    { index: 1, outcome: "pass", resolvedTo: null, durationMs: 2, valueType: "undefined" },
  ],
};

describe("selected entry evidence", () => {
  it("preserves an exact cell and entry in a share link", () => {
    const path = new URL(entryPath("report-id", cell, 1), "https://compatlab.me");
    expect(selectEntry([cell], Object.fromEntries(path.searchParams))).toEqual({ cell, entry });
    expect(path.hash).toBe("#selected-result");
    for (const value of ["-1", "512", "1.5", "01", "NaN", ["1", "2"]])
      expect(selectEntry([cell], { cell: cellAnchor(cell), entry: value })).toBeNull();
    expect(selectEntry([cell], { cell: "unknown", entry: "1" })).toBeNull();
    expect(selectEntry([cell], { cell: [cellAnchor(cell)], entry: "1" })).toBeNull();
  });
  it("keeps a recorded undefined value distinct from absent evidence", () => {
    expect(recordedValueType(cell, entry, raw)).toBe("undefined");
    expect(recordedValueType(cell, entry, null)).toBeNull();
    expect(recordedValueType(cell, entry, { ...raw, observations: [] })).toBeNull();
  });
  it("does not attribute evidence from another entry or runtime", () => {
    expect(recordedValueType(cell, entry, { ...raw, profileId: "another_runtime" })).toBeNull();
    expect(recordedValueType(cell, entry, { ...raw, mode: "esm" })).toBeNull();
    expect(
      recordedValueType(cell, entry, { ...raw, entries: ["example/client", "example/other"] }),
    ).toBeNull();
    expect(recordedValueType(cell, { ...entry, outcome: "inconclusive" }, raw)).toBeNull();
  });
  it("uses the fresh confirmation at index zero instead of the batch value", () => {
    const probeId = randomUUID();
    const freshEntry: typeof entry = {
      ...entry,
      isolation: {
        priorFailureIndex: 0,
        batchFailure: {
          classification: "unclassified_runtime_failure",
          origin: "package",
          phase: "module_evaluation",
          message: "batch failure",
          source: "harness_observation",
          retryable: false,
        },
        confirmation: { method: "fresh_entry_v2", probeId, stopReason: "completed", durationMs: 1 },
      },
    };
    const evidence: ProbeGroupResult = {
      ...raw,
      confirmations: [
        {
          method: "fresh_entry_v2",
          index: 1,
          session: {
            probeId,
            startIndex: 0,
            stopReason: "completed",
            exitCode: 0,
            oomKilled: false,
            durationMs: 1,
            checkpoint: {
              schemaVersion: 2,
              probeId,
              mode: cell.mode,
              group: cell.group,
              completed: true,
              activeIndex: null,
              observations: [
                {
                  index: 0,
                  outcome: "pass",
                  resolvedTo: null,
                  durationMs: 1,
                  valueType: "function",
                },
              ],
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
      ],
    };
    expect(recordedValueType(cell, freshEntry, evidence)).toBe("function");
    expect(recordedValueType(cell, freshEntry, raw)).toBeNull();
    if (!evidence.confirmations?.[0]) throw new Error("Missing fixture confirmation.");
    evidence.confirmations[0].session.stopReason = "entry_timeout";
    expect(recordedValueType(cell, freshEntry, evidence)).toBeNull();
  });
});
