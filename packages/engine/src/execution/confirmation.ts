import type { ProbeGroupResult } from "@compatlab/contracts";

// A failed load can leave loader state behind, and its effect on later entries does not depend on
// their error codes. Each session is a fresh process, so only failures within one session count.
export function confirmationCandidates(
  evidence: Pick<ProbeGroupResult, "group" | "sessions">,
): Map<number, number> {
  const candidates = new Map<number, number>();
  if (evidence.group !== "subpaths") return candidates;
  for (const session of evidence.sessions) {
    let prior: number | undefined;
    for (const observation of session.checkpoint?.observations ?? []) {
      if (observation.outcome !== "fail") continue;
      if (prior === undefined) prior = observation.index;
      else candidates.set(observation.index, prior);
    }
  }
  return candidates;
}
