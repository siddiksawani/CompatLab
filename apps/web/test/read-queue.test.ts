import { expect, it, vi } from "vitest";
import { createReadQueue, ReadBusy } from "../src/server/read-queue";
import { createServerRead } from "../src/server/server-read";

it("shares an unfinished read, bounds its consumers and reselects completed evidence", async () => {
  const queue = createReadQueue<number>();
  const held = Promise.withResolvers<number>();
  const read = vi.fn(() => held.promise);
  const burst = Array.from({ length: 16 }, () => queue("same", read));
  await expect(queue("same", read)).rejects.toBeInstanceOf(ReadBusy);
  expect(read).toHaveBeenCalledTimes(1);
  held.resolve(1);
  expect(await Promise.all(burst)).toEqual(Array(16).fill(1));
  expect(await queue("same", async () => 2)).toBe(2);
});
it("keeps two active reads, queues eight keys and expires waiters without freeing active slots", async () => {
  vi.useFakeTimers();
  try {
    const queue = createReadQueue<number>();
    const held = Promise.withResolvers<number>();
    const read = vi.fn(() => held.promise);
    const first = queue("first", read),
      second = queue("second", read);
    const waiting = Array.from({ length: 8 }, (_, i) =>
      queue(`waiting${i}`, read).catch((error: unknown) => error),
    );
    await expect(queue("excess", read)).rejects.toBeInstanceOf(ReadBusy);
    await vi.advanceTimersByTimeAsync(250);
    expect((await Promise.all(waiting)).every((error) => error instanceof ReadBusy)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    const nextRead = vi.fn(async () => 3);
    const next = queue("next", nextRead);
    expect(nextRead).not.toHaveBeenCalled();
    held.resolve(1);
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(1);
    await expect(next).resolves.toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
it("releases failed work and starts the queued read without caching the error", async () => {
  const queue = createReadQueue<number>();
  const held = Promise.withResolvers<number>();
  const first = queue("first", () => held.promise).catch((error: unknown) => error);
  const second = queue("second", () => held.promise).catch((error: unknown) => error);
  const next = queue("next", async () => 3);
  held.reject(new Error("authored failure"));
  expect(await first).toBeInstanceOf(Error);
  expect(await second).toBeInstanceOf(Error);
  expect(await next).toBe(3);
  expect(await queue("first", async () => 4)).toBe(4);
});
it("shares one bounded busy retry and gives each consumer an independently readable response", async () => {
  const api = vi.fn(async () => new Response('{"value":1}'));
  api.mockImplementationOnce(
    async () =>
      new Response('{"error":"busy"}', {
        status: 503,
        headers: { "retry-after": "1" },
      }),
  );
  const read = createServerRead(api);
  const responses = await Promise.all(Array.from({ length: 12 }, () => read("/report")));
  expect(api).toHaveBeenCalledTimes(2);
  expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
    Array(12).fill({ value: 1 }),
  );
  await read("/report");
  expect(api).toHaveBeenCalledTimes(3);
});
it("does not retry missing evidence, database failures or long retry delays", async () => {
  for (const [status, error, delay] of [
    [404, "not_found", "2"],
    [503, "temporarily_unavailable", "2"],
    [503, "busy", "60"],
  ] as const) {
    const api = vi.fn(
      async () =>
        new Response(JSON.stringify({ error }), { status, headers: { "retry-after": delay } }),
    );
    const response = await createServerRead(api)("/report");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(api).toHaveBeenCalledTimes(1);
  }
});
it("returns retryable unavailable when the server read queue is full, then recovers", async () => {
  const held = Promise.withResolvers<Response>();
  const read = createServerRead(() => held.promise);
  const burst = Array.from({ length: 16 }, () => read("/same"));
  const busy = await read("/same");
  expect(busy.status).toBe(503);
  expect(busy.headers.get("retry-after")).toBe("2");
  expect(busy.headers.get("cache-control")).toBe("no-store");
  held.resolve(new Response("authored"));
  expect((await Promise.all(burst)).every((response) => response.status === 200)).toBe(true);
});
