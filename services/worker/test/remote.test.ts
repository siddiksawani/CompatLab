import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlClient } from "../src/remote/client.js";
import { JobLease } from "../src/remote/lease.js";

afterEach(() => vi.useRealTimers());
const initial = { remainingMs: 30_000, scanRemainingMs: 900_000 };
describe("worker lease watchdog", () => {
  it("cancels before expiry even when a renewal never resolves", async () => {
    vi.useFakeTimers();
    const renew = vi.fn(() => new Promise<never>(() => {}));
    const lease = new JobLease(initial, performance.now(), renew, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(lease.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1001);
    expect(lease.signal.aborted).toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
    lease.close();
  });
  it("accounts for request latency and refuses an already expired lease", () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => initial);
    const lease = new JobLease(
      initial,
      performance.now() - 28_000,
      renew,
      new AbortController().signal,
    );
    expect(lease.signal.aborted).toBe(true);
    expect(renew).not.toHaveBeenCalled();
    lease.close();
  });
  it("aborts promptly after a denied renewal and cannot revive a stopped lease", async () => {
    vi.useFakeTimers();
    const denied = new JobLease(
      initial,
      performance.now(),
      async () => {
        throw new Error("revoked");
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(denied.signal.aborted).toBe(true);
    denied.close();
    const pending = Promise.withResolvers<unknown>();
    const stopped = new JobLease(
      initial,
      performance.now(),
      () => pending.promise,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    stopped.close();
    pending.resolve(initial);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stopped.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors the remaining scan deadline across renewed leases", async () => {
    vi.useFakeTimers();
    const lease = new JobLease(
      { ...initial, scanRemainingMs: 12_000 },
      performance.now(),
      async () => initial,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(9001);
    expect(lease.signal.aborted).toBe(true);
    lease.close();
  });
});

describe("private control transport", () => {
  it("rejects public destinations, DNS names and credential-bearing origins", () => {
    for (const url of [
      "https://example.com",
      "http://8.8.8.8",
      "http://user:pass@10.0.0.1",
      "http://10.0.0.1/other",
      "http://169.254.169.254",
      "file:///tmp/control",
    ])
      expect(() => new ControlClient(url, `clw_${"a".repeat(43)}`)).toThrow();
  });
  it("never follows redirects with a worker bearer token", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(302, { location: "http://127.0.0.1:1/leak" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const client = new ControlClient(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        `clw_${"a".repeat(43)}`,
      );
      await expect(client.post("/v1/jobs/claim", { sessionId: "fixture" })).rejects.toMatchObject({
        status: 302,
      });
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("cancels a stalled control request without waiting for the response", async () => {
    const arrived = Promise.withResolvers<void>();
    const server = createServer(() => arrived.resolve());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const cancellation = new AbortController();
      const client = new ControlClient(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        `clw_${"a".repeat(43)}`,
      );
      const request = client.post("/v1/jobs/claim", {}, cancellation.signal);
      const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
      await arrived.promise;
      cancellation.abort();
      await rejection;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
