import type {
  CompatibilityOutcome,
  NormalizedFailure,
  ProbeGroupResult,
  ProbeMode,
  ReportCell,
} from "@compatlab/contracts";
import { classifyLoad, classifyStop } from "./failures.js";
import type { OptionalPeerContext } from "./optional-peers.js";
import { displayIdentifier, sanitizeText } from "./text.js";

export function combineOutcomes(values: readonly CompatibilityOutcome[]): CompatibilityOutcome {
  const applicable = values.filter((value) => value !== "not_applicable");
  if (!applicable.length) return "not_applicable";
  if (applicable.includes("infrastructure_error")) return "infrastructure_error";
  if (applicable.includes("inconclusive")) return "inconclusive";
  if (applicable.every((value) => value === "unsupported")) return "unsupported";
  if (applicable.includes("partial") || new Set(applicable).size > 1) return "partial";
  return applicable[0] ?? "inconclusive";
}

export function failureOutcome(failure: NormalizedFailure): CompatibilityOutcome {
  if (failure.origin === "infrastructure") return "infrastructure_error";
  return failure.classification === "native_compilation_required" ? "unsupported" : "inconclusive";
}

export function classifyCell(input: {
  runId: string | null;
  profileId: string;
  group: "root" | "subpaths";
  mode: ProbeMode;
  entries: readonly string[] | null;
  evidence: ProbeGroupResult | null;
  failure: NormalizedFailure | null;
  optionalPeers?: OptionalPeerContext;
}): ReportCell {
  const { evidence } = input;
  const observations = new Map(evidence?.observations.map((entry) => [entry.index, entry]));
  const interruptions = new Map(
    evidence?.interruptions
      .filter((entry) => entry.index !== null)
      .map((entry) => [entry.index, classifyStop(entry.reason)]),
  );
  const failures = evidence?.interruptions.map((entry) => classifyStop(entry.reason)) ?? [];
  const interruptedFailure =
    failures.find((failure) => failure.origin === "infrastructure") ?? failures[0] ?? null;
  const failure = input.failure ?? interruptedFailure;
  const entries = (input.entries ?? []).map((specifier, index) => {
    const observation = observations.get(index);
    const error =
      observation?.outcome === "fail"
        ? classifyLoad(observation, input.mode, input.optionalPeers)
        : (interruptions.get(index) ?? null);
    return {
      index,
      specifier,
      displaySpecifier: displayIdentifier(specifier),
      outcome:
        error?.origin === "prerequisite"
          ? ("inconclusive" as const)
          : (observation?.outcome ?? (error ? failureOutcome(error) : ("inconclusive" as const))),
      durationMs: observation?.durationMs ?? null,
      resolvedTo: observation?.resolvedTo ? sanitizeText(observation.resolvedTo) : null,
      failure: error,
    };
  });
  const passed = evidence?.observations.filter((entry) => entry.outcome === "pass").length ?? 0;
  const failed = evidence?.observations.filter((entry) => entry.outcome === "fail").length ?? 0;
  const prerequisiteLimited = entries.filter(
    (entry) => entry.failure?.classification === "optional_peer_missing",
  ).length;
  const inapplicable = input.entries !== null && input.entries.length === 0;
  const complete = inapplicable || (!failure && !!evidence?.coverage.complete);
  const outcome = inapplicable
    ? "not_applicable"
    : failure
      ? failureOutcome(failure)
      : !evidence
        ? "infrastructure_error"
        : !evidence.entries.length
          ? "not_applicable"
          : !complete
            ? "inconclusive"
            : combineOutcomes(entries.map((entry) => entry.outcome));
  return {
    runId: input.runId,
    profileId: input.profileId,
    group: input.group,
    mode: input.mode,
    method: input.group === "root" ? "fresh_root_v2" : "sequential_batch_v2",
    outcome,
    evidenceLevel: passed + failed > 0 ? "smoke_tested" : "static_only",
    coverage: {
      planned: input.entries?.length ?? null,
      observed: passed + failed,
      passed,
      failed,
      prerequisiteLimited,
      interrupted: evidence?.coverage.interrupted ?? 0,
      untested:
        input.entries === null
          ? null
          : input.entries.length - passed - failed - (evidence?.coverage.interrupted ?? 0),
      complete,
    },
    durationMs: evidence?.sessions.reduce((sum, session) => sum + session.durationMs, 0) ?? 0,
    failure: inapplicable
      ? null
      : (failure ?? entries.find((entry) => entry.failure)?.failure ?? null),
    entries,
    sessions:
      evidence?.sessions.map(
        ({ probeId, startIndex, stopReason, exitCode, oomKilled, durationMs }) => ({
          probeId,
          startIndex,
          stopReason,
          exitCode,
          oomKilled,
          durationMs,
        }),
      ) ?? [],
  };
}
