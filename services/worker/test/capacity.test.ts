import { expect, it, vi } from "vitest";
import { CapacityPool } from "../src/lifecycle/capacity.js";
import { CleanupError } from "../src/lifecycle/cleanup.js";

const ample = async () => ({ memory: 32 * 1024 ** 3, disk: 100 * 1024 ** 3 });
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it("caps three runtime slots and gives another waiting scan priority", async () => {
  const pool = new CapacityPool(ample);
  const gates = Array.from({ length: 5 }, deferred);
  const order: string[] = [];
  const work = (index: number, scan: string) =>
    pool.run("runtime", scan, signal(), async () => {
      order.push(scan);
      await gates[index]?.promise;
    });
  const first = [work(0, "a"), work(1, "a"), work(2, "a")];
  await vi.waitFor(() => expect(order).toHaveLength(3));
  const same = work(3, "a"),
    other = work(4, "b");
  gates[0]?.resolve();
  await vi.waitFor(() => expect(order).toEqual(["a", "a", "a", "b"]));
  expect(pool.reservations).toBe(3);
  for (const gate of gates) gate.resolve();
  await Promise.all([...first, same, other]);
  expect(pool.reservations).toBe(0);
});
it("allows only one preparation while runtime slots remain available", async () => {
  const pool = new CapacityPool(ample),
    first = deferred();
  const started: string[] = [];
  const one = pool.run("preparation", "a", signal(), async () => {
    started.push("one");
    await first.promise;
  });
  const two = pool.run("preparation", "b", signal(), async () => {
    started.push("two");
  });
  await pool.run("runtime", "c", signal(), async () => {
    started.push("runtime");
  });
  expect(started).toEqual(["one", "runtime"]);
  first.resolve();
  await Promise.all([one, two]);
  expect(started.at(-1)).toBe("two");
});
it("rejects low disk or memory before invoking package work", async () => {
  for (const capacity of [
    { memory: 1024 ** 3, disk: 100 * 1024 ** 3 },
    { memory: 32 * 1024 ** 3, disk: 1024 ** 3 },
  ]) {
    const pool = new CapacityPool(async () => capacity),
      work = vi.fn();
    await expect(pool.run("runtime", "a", signal(), work)).rejects.toThrow("headroom");
    expect(work).not.toHaveBeenCalled();
    expect(pool.reservations).toBe(0);
  }
});
it("cancels queued work and holds capacity after failed cleanup", async () => {
  const pool = new CapacityPool(ample),
    gate = deferred(),
    controller = new AbortController();
  const running = pool.run("preparation", "a", signal(), () => gate.promise);
  const work = vi.fn();
  const queued = pool.run("preparation", "b", controller.signal, work);
  controller.abort();
  await expect(queued).rejects.toThrow();
  gate.resolve();
  await running;
  expect(work).not.toHaveBeenCalled();
  await expect(
    pool.run("runtime", "a", signal(), async () => {
      throw new CleanupError(new Error("busy mount"));
    }),
  ).rejects.toThrow("cleanup");
  expect(pool.blocked).toBe(true);
  expect(pool.reservations).toBe(1);
  await expect(pool.run("runtime", "b", signal(), work)).rejects.toThrow("admission is stopped");
});
it("releases reservations after ordinary failures with completed cleanup", async () => {
  const pool = new CapacityPool(ample);
  await expect(
    pool.run("runtime", "a", signal(), async () => {
      throw new Error("load failed");
    }),
  ).rejects.toThrow("load failed");
  expect(pool.reservations).toBe(0);
  expect(pool.blocked).toBe(false);
});
