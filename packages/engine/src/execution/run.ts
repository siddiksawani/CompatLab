import { randomUUID } from "node:crypto";
import {
  MAX_REPORT_BYTES,
  MAX_SCAN_LOG_BYTES,
  PROBE_LIMITS,
  type ProbeGroupResult,
  type ProbeInput,
  type ProbePlan,
  type ProbeSession,
  parseProbeCheckpoint,
  probeSessionSchema,
  type RuntimeImage,
} from "@compatlab/contracts";

export type SandboxBackend = {
  run(input: ProbeInput, image: RuntimeImage, signal: AbortSignal): Promise<ProbeSession>;
};

export async function executePlan(
  plan: ProbePlan,
  images: readonly RuntimeImage[],
  backend: SandboxBackend,
  signal: AbortSignal,
  maxResultBytes = MAX_REPORT_BYTES,
): Promise<ProbeGroupResult[]> {
  if (
    !Number.isSafeInteger(maxResultBytes) ||
    maxResultBytes < 1024 ||
    maxResultBytes > MAX_REPORT_BYTES
  )
    throw new TypeError("The report has insufficient evidence space.");
  if (
    plan.runtimes.length !== images.length ||
    plan.runtimes.some((runtime, index) => runtime.profileId !== images[index]?.profileId)
  )
    throw new TypeError("The plan and immutable runtime matrix differ.");
  const results: ProbeGroupResult[] = [];
  const assertBudget = () => {
    if (Buffer.byteLength(JSON.stringify(results)) > maxResultBytes)
      throw new TypeError(
        "The report evidence byte limit was reached; further probes were stopped.",
      );
  };
  let remainingLogs = MAX_SCAN_LOG_BYTES;
  for (const [runtimeIndex, runtime] of plan.runtimes.entries()) {
    const image = images[runtimeIndex];
    if (!image) throw new TypeError("Missing runtime image.");
    for (const group of ["root", "subpaths"] as const)
      for (const mode of ["esm", "commonjs"] as const) {
        const entries = (group === "root" ? [runtime.root] : runtime.entries)
          .filter((entry) => entry[mode].applicable)
          .map((entry) => entry.specifier);
        const result: ProbeGroupResult = {
          profileId: runtime.profileId,
          group,
          mode,
          method: group === "root" ? "fresh_root_v2" : "sequential_batch_v2",
          entries,
          sessions: [],
          observations: [],
          interruptions: [],
          coverage: {
            planned: entries.length,
            observed: 0,
            interrupted: 0,
            untested: entries.length,
            complete: entries.length === 0,
          },
        };
        results.push(result);
        assertBudget();
        let startIndex = 0;
        while (
          startIndex < entries.length &&
          result.sessions.length <= (group === "root" ? 0 : PROBE_LIMITS.restarts) &&
          !signal.aborted
        ) {
          const input: ProbeInput = {
            schemaVersion: 2,
            probeId: randomUUID(),
            group,
            mode,
            entries,
            startIndex,
          };
          const session = probeSessionSchema.parse(await backend.run(input, image, signal));
          if (session.probeId !== input.probeId || session.startIndex !== input.startIndex)
            throw new TypeError("The sandbox returned a result for a different probe.");
          if (session.checkpoint)
            parseProbeCheckpoint(Buffer.from(JSON.stringify(session.checkpoint)), input);
          if (
            session.stopReason === "completed" &&
            (session.exitCode !== 0 || session.oomKilled || !session.checkpoint?.completed)
          )
            throw new TypeError("The sandbox reported completion without valid evidence.");
          for (const stream of ["stdout", "stderr"] as const) {
            const bytes = Buffer.from(session.logs[stream]);
            if (bytes.length > remainingLogs) session.logs[`${stream}Truncated`] = true;
            session.logs[stream] = new TextDecoder().decode(bytes.subarray(0, remainingLogs), {
              stream: true,
            });
            remainingLogs -= Math.min(bytes.length, remainingLogs);
          }
          result.sessions.push(session);
          if (session.checkpoint) result.observations.push(...session.checkpoint.observations);
          assertBudget();
          if (session.stopReason === "completed") {
            startIndex = entries.length;
            break;
          }
          const active = session.checkpoint?.activeIndex ?? null;
          result.interruptions.push({ index: active, reason: session.stopReason });
          if (
            active === null ||
            ![
              "entry_timeout",
              "batch_timeout",
              "unexpected_process_exit",
              "memory_limit_exceeded",
              "output_limit_exceeded",
            ].includes(session.stopReason)
          )
            break;
          startIndex = active + 1;
        }
        result.coverage.observed = result.observations.length;
        result.coverage.interrupted = result.interruptions.filter(
          (item) => item.index !== null,
        ).length;
        result.coverage.untested =
          entries.length - result.coverage.observed - result.coverage.interrupted;
        result.coverage.complete =
          result.coverage.observed === entries.length &&
          result.interruptions.length === 0 &&
          (entries.length === 0 || result.sessions.at(-1)?.stopReason === "completed");
        assertBudget();
      }
  }
  return results;
}
