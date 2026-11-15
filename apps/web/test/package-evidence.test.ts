import { findOtherReportObservations } from "@compatlab/catalog/web";
import { expect, it, vi } from "vitest";
import { otherReportObservations } from "../src/server/package-evidence";

vi.mock("@compatlab/catalog/web", () => ({
  findOtherReportObservations: vi.fn(),
  reportControlError: vi.fn(),
}));
vi.mock("../src/server/runtime", () => ({ webRuntime: () => ({ catalog: { db: {} } }) }));

it("returns without optional observations when reads are slow and keeps their slots occupied", async () => {
  vi.useFakeTimers();
  const held = Promise.withResolvers<Awaited<ReturnType<typeof findOtherReportObservations>>>();
  const query = vi.mocked(findOtherReportObservations);
  query.mockReturnValue(held.promise);
  try {
    const first = otherReportObservations("first");
    const second = otherReportObservations("second");
    await vi.advanceTimersByTimeAsync(500);
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);

    const queued = otherReportObservations("third");
    await vi.advanceTimersByTimeAsync(250);
    await expect(queued).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);

    held.resolve([]);
    await expect(otherReportObservations("fourth")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  } finally {
    held.resolve([]);
    vi.useRealTimers();
  }
});
