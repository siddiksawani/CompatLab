import { expect, it } from "vitest";
import { type RuntimeState, runtimeOutcome } from "../src/runtime/outcome.js";

const state: RuntimeState = {
  Running: false,
  OOMKilled: false,
  ExitCode: 0,
  Error: "",
  StartedAt: "2026-10-03T00:00:00Z",
};
it.each([1, 125, 126, 127, 137])(
  "distinguishes a package exit %i from failure to start Docker",
  (exitCode) => {
    expect(
      runtimeOutcome(
        { exitCode, termination: "completed" },
        { ...state, ExitCode: exitCode },
        null,
        true,
      ),
    ).toBe("unexpected_process_exit");
  },
);
it("requires successful runtime state and completion while preserving external stops", () => {
  const process = { exitCode: 0, termination: "completed" as const };
  expect(runtimeOutcome(process, state, null, true)).toBe("completed");
  expect(runtimeOutcome(process, state, null, false)).toBe("harness_protocol_error");
  expect(runtimeOutcome(process, null, null, true)).toBe("sandbox_start_failed");
  expect(runtimeOutcome(process, { ...state, Error: "runtime failed" }, null, true)).toBe(
    "sandbox_start_failed",
  );
  expect(runtimeOutcome(process, { ...state, OOMKilled: true }, null, true)).toBe(
    "memory_limit_exceeded",
  );
  expect(runtimeOutcome(process, state, "cancelled", true)).toBe("cancelled");
  expect(
    runtimeOutcome({ ...process, termination: "output_limit_exceeded" }, state, null, true),
  ).toBe("output_limit_exceeded");
});
