import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn, setTimeout as sleep } from "node:timers/promises";
import type { JobAssignment, JobResult } from "@compatlab/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExecutionSupervisor } from "../src/lifecycle/supervisor.js";
import { runWorker } from "../src/remote/agent.js";
import { ControlClient } from "../src/remote/client.js";
import { executeAssignment } from "../src/remote/work.js";

vi.mock("../src/lifecycle/supervisor.js", () => ({
  ExecutionSupervisor: { open: vi.fn() },
}));
vi.mock("../src/remote/work.js", () => ({ executeAssignment: vi.fn() }));

const assignment = (): JobAssignment => ({
  schemaVersion: 1,
  kind: "preparation",
  jobId: randomUUID(),
  scanId: randomUUID(),
  preparationId: randomUUID(),
  attemptToken: randomUUID(),
  attempt: 1,
  lease: { remainingMs: 30_000, scanRemainingMs: 900_000 },
  artifact: {
    name: "fixture",
    version: "1.0.0",
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    tarballUrl: "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz",
  },
  profileRevision: "npm_11_19_0_linux_amd64_v2",
});
const result: JobResult = {
  kind: "failure",
  origin: "preparation",
  classification: "dependency_install_failed",
  message: "Authored preparation failure.",
};
const empty = { job: null, snapshotIds: [] };
let cancellation: AbortController;
let worker: Promise<void> | undefined;
const supervisor = {
  snapshotInventory: vi.fn(async () => []),
  collect: vi.fn(async () => 0),
  replaceSnapshotPins: vi.fn(),
  withScan: vi.fn(async (work: (id: string) => Promise<void>) => work(randomUUID())),
  close: vi.fn(async () => {}),
  capacity: { blocked: false },
};

beforeEach(() => {
  vi.useFakeTimers();
  cancellation = new AbortController();
  vi.mocked(ExecutionSupervisor.open).mockResolvedValue(
    supervisor as unknown as ExecutionSupervisor,
  );
});
afterEach(async () => {
  cancellation.abort();
  await worker;
  worker = undefined;
  vi.useRealTimers();
});

async function start() {
  worker = runWorker({
    controlUrl: "http://127.0.0.1:4000",
    token: `clw_${"a".repeat(43)}`,
    stateDirectory: "/test-state",
    signal: cancellation.signal,
  });
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await nextTurn();
}

it.each([false, true])(
  "claims again when a job completes, including during a pending claim: %s",
  async (completeDuringClaim) => {
    const completed = Promise.withResolvers<JobResult>();
    const pendingClaim = Promise.withResolvers<unknown>();
    vi.mocked(executeAssignment).mockReturnValueOnce(completed.promise);
    let claims = 0;
    const post = vi.spyOn(ControlClient.prototype, "post").mockImplementation(async (path) => {
      if (path !== "/v1/jobs/claim") return {};
      claims++;
      if (claims === 1) return { ...empty, job: assignment() };
      if (claims === 2 && completeDuringClaim) return pendingClaim.promise;
      return empty;
    });
    await start();
    expect(claims).toBe(2);
    completed.resolve(result);
    await vi.advanceTimersByTimeAsync(1);
    if (completeDuringClaim) {
      expect(claims).toBe(2);
      pendingClaim.resolve(empty);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(claims).toBe(3);
    expect(post.mock.calls.filter(([path]) => path === "/v1/jobs/results")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(claims).toBe(3);
  },
);

it("backs off when fully idle and cancels its wait on shutdown", async () => {
  vi.useRealTimers();
  const polled = Promise.withResolvers<void>();
  let claims = 0;
  vi.spyOn(ControlClient.prototype, "post").mockImplementation(async (path) => {
    if (path === "/v1/jobs/claim" && ++claims === 2) polled.resolve();
    return empty;
  });
  const started = performance.now();
  await start();
  expect(claims).toBe(1);
  await sleep(100);
  expect(claims).toBe(1);
  await polled.promise;
  expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
  expect(claims).toBe(2);
  cancellation.abort();
  await worker;
  expect(supervisor.close).toHaveBeenCalledOnce();
  expect(claims).toBe(2);
});

it("keeps the three-job local limit while waiting for capacity", async () => {
  const running: Array<ReturnType<typeof Promise.withResolvers<JobResult>>> = [];
  vi.mocked(executeAssignment).mockImplementation(async (_supervisor, _job, signal) => {
    const operation = Promise.withResolvers<JobResult>();
    signal.addEventListener("abort", () => operation.reject(signal.reason), { once: true });
    running.push(operation);
    return operation.promise;
  });
  let claims = 0;
  vi.spyOn(ControlClient.prototype, "post").mockImplementation(async (path) => {
    if (path !== "/v1/jobs/claim") return {};
    claims++;
    return { ...empty, job: assignment() };
  });
  await start();
  expect(claims).toBe(3);
  expect(running).toHaveLength(3);
  running[0]?.resolve(result);
  await vi.advanceTimersByTimeAsync(1);
  expect(claims).toBe(4);
  cancellation.abort();
  await worker;
  expect(supervisor.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
