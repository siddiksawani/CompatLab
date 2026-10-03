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
  private readonly protectedSnapshots = new Set<string>();
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
        await collectSnapshots(lease.previousState);
      }
      await recoverResources(state);
      await collectSnapshots(state);
      return new ExecutionSupervisor(state, lease);
    } catch (error) {
      await lease.close();
      throw error;
    }
  }
  pinSnapshot(id: string): void {
    this.protectedSnapshots.add(id);
  }
  async prepare(
    artifact: ResolvedArtifact,
    scanId: string,
    signal: AbortSignal,
    retainedLock?: Uint8Array,
  ): Promise<PreparedSnapshot> {
    const combined = this.signal(signal);
    return this.track(
      this.capacity.run("preparation", scanId, combined, async () => {
        await collectSnapshots(this.stateDirectory, this.protectedSnapshots, 6 * 1024 ** 3);
        const snapshot = await prepareArtifact(
          artifact,
          join(this.stateDirectory, "snapshots"),
          combined,
          retainedLock,
        );
        this.pinSnapshot(snapshot.id);
        return snapshot;
      }),
    );
  }
  async backend(
    snapshot: PreparedSnapshot,
    images: readonly RuntimeImage[],
    scanId: string,
  ): Promise<SandboxBackend> {
    this.pinSnapshot(snapshot.id);
    const backend = await createProbeBackend(
      snapshot.workspace,
      join(this.stateDirectory, "jobs"),
      images,
    );
    return {
      run: (input, image, signal) => {
        const combined = this.signal(signal);
        return this.track(
          this.capacity.run("runtime", scanId, combined, () => backend.run(input, image, combined)),
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
  private signal(signal: AbortSignal): AbortSignal {
    if (this.closed) throw new Error("The supervisor is closed.");
    return AbortSignal.any([signal, this.cancellation.signal, this.lease.lost]);
  }
  private async track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
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
