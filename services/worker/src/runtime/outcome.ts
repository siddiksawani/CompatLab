import type { StopReason } from "@compatlab/contracts";
import type { CommandResult } from "../command.js";

export type RuntimeState = {
  Running: boolean;
  OOMKilled: boolean;
  ExitCode: number;
  Error: string;
  StartedAt: string;
};
export function runtimeOutcome(
  process: Pick<CommandResult, "exitCode" | "termination">,
  state: RuntimeState | null,
  override: StopReason | null,
  completed: boolean,
): StopReason {
  if (override) return override;
  if (process.termination === "output_limit_exceeded") return "output_limit_exceeded";
  if (!state || state.Error || !state.StartedAt || state.StartedAt.startsWith("0001-"))
    return "sandbox_start_failed";
  if (state.OOMKilled) return "memory_limit_exceeded";
  if (state.Running || state.ExitCode !== 0 || process.exitCode !== 0)
    return "unexpected_process_exit";
  return completed ? "completed" : "harness_protocol_error";
}
