import { randomUUID } from "node:crypto";
import type { LoadObservation, ProbeGroupResult, ProbeSession } from "@compatlab/contracts";
import { describe, expect, it } from "vitest";
import { verifyEvidence } from "../src/scheduling/results.js";

const error = { name: "Error", message: "Authored batch failure", code: null };
function session(startIndex: number, observations: LoadObservation[]): ProbeSession {
  const probeId = randomUUID();
  return {
    probeId,
    startIndex,
    stopReason: "completed",
    exitCode: 0,
    oomKilled: false,
    durationMs: 1,
    checkpoint: {
      schemaVersion: 2,
      probeId,
      group: "subpaths",
      mode: "commonjs",
      completed: true,
      activeIndex: null,
      observations,
    },
    logs: {
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      emittedBytes: 0,
    },
  };
}
function evidence(): ProbeGroupResult {
  const observations: LoadObservation[] = [0, 1, 2].map((index) => ({
    index,
    outcome: "fail",
    resolvedTo: null,
    durationMs: 1,
    error,
  }));
  return {
    profileId: "node_24_21_0",
    group: "subpaths",
    mode: "commonjs",
    method: "sequential_batch_v2",
    entries: ["fixture/test", "fixture/db/adapter", "fixture/db/migration"],
    sessions: [session(0, observations)],
    confirmations: [1, 2].map((index) => ({
      method: "fresh_entry_v2" as const,
      index,
      session: session(0, [
        { index: 0, outcome: "pass", resolvedTo: null, durationMs: 1, valueType: "object" },
      ]),
    })),
    observations,
    interruptions: [],
    coverage: { planned: 3, observed: 3, interrupted: 0, untested: 0, complete: true },
  };
}

describe("submitted fresh-process confirmations", () => {
  it("accepts a bounded prefix of genuine candidates and historical evidence", () => {
    expect(() => verifyEvidence(evidence())).not.toThrow();
    const prefix = evidence();
    prefix.confirmations = prefix.confirmations?.slice(0, 1);
    expect(() => verifyEvidence(prefix)).not.toThrow();
    const historical = evidence();
    delete historical.confirmations;
    expect(() => verifyEvidence(historical)).not.toThrow();
  });

  it.each<[string, (value: ProbeGroupResult) => void]>([
    ["the first failure", (value) => value.confirmations?.splice(0, 2, confirmationAt(value, 0))],
    ["a skipped candidate", (value) => value.confirmations?.shift()],
    ["a duplicated entry", (value) => value.confirmations?.splice(1, 1, confirmationAt(value, 1))],
    [
      "a passed batch entry",
      (value) => {
        value.observations[1] = {
          index: 1,
          outcome: "pass",
          resolvedTo: null,
          durationMs: 1,
          valueType: "object",
        };
        value.observations[2] = {
          index: 2,
          outcome: "fail",
          resolvedTo: null,
          durationMs: 1,
          error,
        };
        value.confirmations?.splice(0, 2, confirmationAt(value, 1));
      },
    ],
    ["a resumed start", (value) => setSession(value, { startIndex: 1 })],
    [
      "a reused batch process",
      (value) => setSession(value, { probeId: value.sessions[0]?.probeId ?? "" }),
    ],
    ["a false completion", (value) => setSession(value, { exitCode: 1 })],
    [
      "a root group",
      (value) => {
        const root = session(0, [value.observations[0] as LoadObservation]);
        if (root.checkpoint) root.checkpoint.group = "root";
        Object.assign(value, {
          group: "root",
          method: "fresh_root_v2",
          entries: ["fixture"],
          sessions: [root],
          observations: root.checkpoint?.observations,
          confirmations: [],
          coverage: { planned: 1, observed: 1, interrupted: 0, untested: 0, complete: true },
        });
      },
    ],
  ])("rejects confirmation evidence for %s", (_name, forge) => {
    const value = evidence();
    forge(value);
    expect(() => verifyEvidence(value)).toThrow(
      expect.objectContaining({ code: "invalid_result" }),
    );
  });

  it("validates confirmation checkpoints against their own single-entry probe", () => {
    const value = evidence();
    const checkpoint = value.confirmations?.[0]?.session.checkpoint;
    if (!checkpoint) throw new Error("Fixture checkpoint missing.");
    checkpoint.probeId = randomUUID();
    expect(() => verifyEvidence(value)).toThrow("another probe");
    checkpoint.probeId = value.confirmations?.[0]?.session.probeId ?? "";
    checkpoint.observations = [{ ...(checkpoint.observations[0] as LoadObservation), index: 1 }];
    expect(() => verifyEvidence(value)).toThrow("out of order");
  });
});

function confirmationAt(value: ProbeGroupResult, index: number) {
  const source = value.confirmations?.[0];
  if (!source) throw new Error("Fixture confirmation missing.");
  return { ...source, index, session: { ...source.session, probeId: randomUUID() } };
}
function setSession(value: ProbeGroupResult, change: Partial<ProbeSession>) {
  const confirmation = value.confirmations?.[0];
  if (!confirmation) throw new Error("Fixture confirmation missing.");
  confirmation.session = { ...confirmation.session, ...change };
  if (confirmation.session.checkpoint && change.probeId)
    confirmation.session.checkpoint = {
      ...confirmation.session.checkpoint,
      probeId: change.probeId,
    };
}
