import type { ProbeGroupResult } from "@compatlab/contracts";

export function executionSummary(
  groups: readonly Pick<ProbeGroupResult, "observations">[],
  signal: AbortSignal,
) {
  const deadlineReached =
    signal.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
  return {
    evidenceLevel: groups.some((group) => group.observations.length > 0)
      ? ("smoke_tested" as const)
      : ("static_only" as const),
    deadlineReached,
    cancelled: signal.aborted && !deadlineReached,
  };
}
