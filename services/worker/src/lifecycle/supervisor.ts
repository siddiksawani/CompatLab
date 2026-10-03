import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeImage } from "@compatlab/contracts";
import type { ResolvedArtifact, SandboxBackend } from "@compatlab/engine";
import {
  assertPreparationHost,
  type PreparedSnapshot,
  prepareArtifact,
} from "../preparation/prepare.js";
import { createProbeBackend } from "../runtime/backend.js";
import { CapacityPool, readHostCapacity } from "./capacity.js";
import { acquireHostLease } from "./lease.js";
import { collectSnapshots, recoverResources } from "./recovery.js";
import { privateDirectory } from "./storage.js";

export class ExecutionSupervisor {
  readonly capacity: CapacityPool;
  private readonly cancellation = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly scans = new Map<
    string,
    {
      snapshots: Set<string>;
      operations: Set<Promise<unknown>>;
      cancellation: AbortController;
    }
  >();
  private closed = false;
  private constructor(
    readonly stateDirectory: string,
    private readonly lease: Awaited<ReturnType<typeof acquireHostLease>>,
  ) {
    this.capacity = new CapacityPool(() => readHostCapacity(stateDirectory));
  }
  static async open(stateDirectory: string): Promise<ExecutionSupervisor> {
    await assertPreparationHost();
    const state = await privateDirectory(stateDirectory);
    const lease = await acquireHostLease(state);
    try {
      if (
        lease.previousState &&
        lease.previousState !== state &&
        (await exists(lease.previousState))
      ) {
        await recoverResources(lease.previousState);
        await collectSnapshots(lease.previousState, new Set(), 0);
      }
      await recoverResources(state);
      await collectSnapshots(state);
      await lease.activate();
      return new ExecutionSupervisor(state, lease);
    } catch (error) {
      await lease.close();
      throw error;
    }
  }
  async withScan<T>(work: (scanId: string) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("The supervisor is closed.");
    const scanId = randomUUID();
    const scan = {
      snapshots: new Set<string>(),
      operations: new Set<Promise<unknown>>(),
      cancellation: new AbortController(),
    };
    this.scans.set(scanId, scan);
    const operation = (async () => {
      try {
        return await work(scanId);
      } finally {
        scan.cancellation.abort();
        await Promise.allSettled([...scan.operations]);
        if (!this.capacity.blocked) this.scans.delete(scanId);
      }
    })();
    return this.track(operation);
  }
  pinSnapshot(id: string, scanId: string): void {
    this.scan(scanId).snapshots.add(id);
  }
  replaceSnapshotPins(ids: readonly string[], scanId: string): void {
    const scan = this.scan(scanId);
    scan.snapshots = new Set(ids);
  }
  private get protectedSnapshots(): ReadonlySet<string> {
    return new Set([...this.scans.values()].flatMap((scan) => [...scan.snapshots]));
  }
  async prepare(
    artifact: ResolvedArtifact,
    scanId: string,
    signal: AbortSignal,
    retainedLock?: Uint8Array,
  ): Promise<PreparedSnapshot> {
    const combined = this.signal(signal, scanId);
    return this.track(
      this.capacity.run("preparation", scanId, combined, async () => {
        await collectSnapshots(this.stateDirectory, this.protectedSnapshots, 6 * 1024 ** 3);
        const snapshot = await prepareArtifact(
          artifact,
          join(this.stateDirectory, "snapshots"),
          combined,
          retainedLock,
        );
        this.pinSnapshot(snapshot.id, scanId);
        return snapshot;
      }),
      scanId,
    );
  }
  async backend(
    snapshot: PreparedSnapshot,
    images: readonly RuntimeImage[],
    scanId: string,
  ): Promise<SandboxBackend> {
    this.pinSnapshot(snapshot.id, scanId);
    const backend = await createProbeBackend(
      snapshot.workspace,
      join(this.stateDirectory, "jobs"),
      images,
    );
    return {
      run: (input, image, signal) => {
        const combined = this.signal(signal, scanId);
        return this.track(
          this.capacity.run("runtime", scanId, combined, () => backend.run(input, image, combined)),
          scanId,
        );
      },
    };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancellation.abort();
    await Promise.allSettled([...this.operations]);
    await this.lease.close();
  }
  private signal(signal: AbortSignal, scanId: string): AbortSignal {
    if (this.closed) throw new Error("The supervisor is closed.");
    return AbortSignal.any([
      signal,
      this.cancellation.signal,
      this.lease.lost,
      this.scan(scanId).cancellation.signal,
    ]);
  }
  private scan(scanId: string) {
    const scan = this.scans.get(scanId);
    if (!scan || scan.cancellation.signal.aborted) throw new Error("The scan scope is closed.");
    return scan;
  }
  private async track<T>(operation: Promise<T>, scanId?: string): Promise<T> {
    const scan = scanId ? this.scan(scanId) : undefined;
    scan?.operations.add(operation);
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
      scan?.operations.delete(operation);
    }
  }
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
