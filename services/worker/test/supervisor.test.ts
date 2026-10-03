import { tmpdir } from "node:os";
import type { ResolvedArtifact } from "@compatlab/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireHostLease } from "../src/lifecycle/lease.js";
import { collectSnapshots } from "../src/lifecycle/recovery.js";
import { ExecutionSupervisor } from "../src/lifecycle/supervisor.js";
import { type PreparedSnapshot, prepareArtifact } from "../src/preparation/prepare.js";

vi.mock("../src/preparation/prepare.js", () => ({
  assertPreparationHost: vi.fn(),
  prepareArtifact: vi.fn(),
}));
vi.mock("../src/lifecycle/lease.js", () => ({ acquireHostLease: vi.fn() }));
vi.mock("../src/lifecycle/recovery.js", () => ({
  recoverResources: vi.fn(),
  collectSnapshots: vi.fn(),
}));
vi.mock("../src/lifecycle/storage.js", () => ({
  privateDirectory: vi.fn(async (path: string) => path),
}));
vi.mock("../src/lifecycle/capacity.js", async (original) => ({
  ...(await original<typeof import("../src/lifecycle/capacity.js")>()),
  readHostCapacity: vi.fn(async () => ({ memory: 16 * 1024 ** 3, disk: 32 * 1024 ** 3 })),
}));

const artifact = {} as ResolvedArtifact;
const snapshot = { id: "shared" } as PreparedSnapshot;
const lease = () => ({
  previousState: null,
  lost: new AbortController().signal,
  close: vi.fn(async () => {}),
});
const signal = () => new AbortController().signal;
async function preparation(supervisor: ExecutionSupervisor) {
  await supervisor.withScan((id) => supervisor.prepare(artifact, id, signal()));
  return vi.mocked(collectSnapshots).mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(acquireHostLease).mockResolvedValue(lease());
  vi.mocked(prepareArtifact).mockResolvedValue(snapshot);
});

describe("scan snapshot ownership", () => {
  it("releases successful and failed scan pins before subsequent collection", async () => {
    const supervisor = await ExecutionSupervisor.open("/state");
    try {
      await preparation(supervisor);
      expect(await preparation(supervisor)).toEqual(new Set());
      await expect(
        supervisor.withScan(async (id) => {
          await supervisor.prepare(artifact, id, signal());
          throw new Error("scan failed");
        }),
      ).rejects.toThrow("scan failed");
      expect(await preparation(supervisor)).toEqual(new Set());
    } finally {
      await supervisor.close();
    }
  });

  it("keeps a shared snapshot pinned until every active scan releases it", async () => {
    const supervisor = await ExecutionSupervisor.open("/state");
    const first = Promise.withResolvers<void>(),
      second = Promise.withResolvers<void>();
    const a = supervisor.withScan(async (id) => {
      supervisor.pinSnapshot("shared", id);
      await first.promise;
    });
    const b = supervisor.withScan(async (id) => {
      supervisor.pinSnapshot("shared", id);
      await second.promise;
    });
    first.resolve();
    await a;
    expect(await preparation(supervisor)).toEqual(new Set(["shared"]));
    second.resolve();
    await b;
    expect(await preparation(supervisor)).toEqual(new Set());
    await supervisor.close();
  });

  it("rejects work from a released scan scope", async () => {
    const supervisor = await ExecutionSupervisor.open("/state");
    let released = "";
    await supervisor.withScan(async (id) => {
      released = id;
    });
    await expect(supervisor.prepare(artifact, released, signal())).rejects.toThrow(
      "scope is closed",
    );
    await supervisor.close();
  });

  it("cancels and drains outstanding preparation before releasing a failed scope", async () => {
    const supervisor = await ExecutionSupervisor.open("/state");
    const started = Promise.withResolvers<void>();
    vi.mocked(prepareArtifact).mockImplementationOnce(
      async (_artifact, _directory, cancellation) => {
        started.resolve();
        await new Promise<void>((_resolve, reject) => {
          cancellation?.addEventListener("abort", () => reject(cancellation.reason), {
            once: true,
          });
        });
        return snapshot;
      },
    );
    await expect(
      supervisor.withScan(async (id) => {
        void supervisor.prepare(artifact, id, signal()).catch(() => {});
        await started.promise;
        throw new Error("scan cancelled");
      }),
    ).rejects.toThrow("scan cancelled");
    expect(supervisor.capacity.reservations).toBe(0);
    expect(await preparation(supervisor)).toEqual(new Set());
    await supervisor.close();
  });

  it("retires the previous root before collecting the new root", async () => {
    vi.mocked(acquireHostLease).mockResolvedValue({ ...lease(), previousState: tmpdir() });
    const supervisor = await ExecutionSupervisor.open("/state");
    expect(vi.mocked(collectSnapshots).mock.calls).toEqual([[tmpdir(), new Set(), 0], ["/state"]]);
    await supervisor.close();
  });
});
