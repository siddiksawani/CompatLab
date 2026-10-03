import { expect, it } from "vitest";
import { executionSummary } from "../src/execution/summary.js";

it("keeps absent loading evidence static-only", () => {
  expect(executionSummary([{ observations: [] }], new AbortController().signal)).toEqual({
    evidenceLevel: "static_only",
    deadlineReached: false,
    cancelled: false,
  });
  expect(
    executionSummary(
      [
        {
          observations: [
            { index: 0, outcome: "pass", valueType: "object", resolvedTo: null, durationMs: 0 },
          ],
        },
      ],
      new AbortController().signal,
    ).evidenceLevel,
  ).toBe("smoke_tested");
});
it("distinguishes user cancellation from deadline expiry", () => {
  expect(executionSummary([], AbortSignal.abort())).toMatchObject({
    cancelled: true,
    deadlineReached: false,
  });
  expect(
    executionSummary([], AbortSignal.abort(new DOMException("Expired", "TimeoutError"))),
  ).toMatchObject({ cancelled: false, deadlineReached: true });
});
