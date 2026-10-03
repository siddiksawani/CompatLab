import { readFile, statfs } from "node:fs/promises";
import { CleanupError } from "./cleanup.js";

const GiB = 1024 ** 3;
export const CAPACITY_POLICY = {
  slots: 3,
  preparationSlots: 1,
  memoryHeadroom: GiB,
  diskHeadroom: 2 * GiB,
  runtime: { memory: 1.5 * GiB, disk: 8 * 1024 ** 2 },
  preparation: { memory: 3 * GiB, disk: 2 * GiB },
} as const;
export type CapacityKind = "runtime" | "preparation";
export type HostCapacity = { memory: number; disk: number };
type Reservation = { kind: CapacityKind; scanId: string };
type Waiting = Reservation & {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};

export class CapacityPool {
  private readonly active = new Set<Reservation>();
  private readonly waiting: Waiting[] = [];
  private pumping = false;
  private quarantined = false;
  constructor(private readonly capacity: () => Promise<HostCapacity>) {}
  get reservations(): number {
    return this.active.size;
  }
  get blocked(): boolean {
    return this.quarantined;
  }

  async run<T>(
    kind: CapacityKind,
    scanId: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(kind, scanId, signal);
    try {
      signal.throwIfAborted();
      const result = await work();
      release();
      return result;
    } catch (error) {
      if (error instanceof CleanupError) {
        this.quarantined = true;
        for (const waiter of [...this.waiting])
          this.remove(waiter, new Error("Worker cleanup failed; admission is stopped."));
      } else release();
      throw error;
    }
  }
  private acquire(kind: CapacityKind, scanId: string, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.quarantined)
      return Promise.reject(new Error("Worker cleanup failed; admission is stopped."));
    return new Promise((resolve, reject) => {
      const waiter: Waiting = {
        kind,
        scanId,
        signal,
        resolve,
        reject,
        abort: () => this.remove(waiter, signal.reason),
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
      void this.pump();
    });
  }
  private remove(waiter: Waiting, error?: unknown) {
    const index = this.waiting.indexOf(waiter);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (error !== undefined) waiter.reject(error);
    void this.pump();
  }
  private async pump(): Promise<void> {
    if (this.pumping || this.quarantined) return;
    this.pumping = true;
    try {
      while (this.waiting.length && this.active.size < CAPACITY_POLICY.slots) {
        const activeScans = new Set([...this.active].map((item) => item.scanId));
        const eligible = this.waiting.filter(
          (item) =>
            item.kind !== "preparation" ||
            ![...this.active].some((active) => active.kind === "preparation"),
        );
        const next = eligible.find((item) => !activeScans.has(item.scanId)) ?? eligible[0];
        if (!next) return;
        let available: HostCapacity;
        try {
          available = await this.capacity();
        } catch (error) {
          this.remove(next, error);
          continue;
        }
        if (next.signal.aborted || !this.waiting.includes(next)) continue;
        const reserved = [...this.active].reduce(
          (sum, item) => ({
            memory: sum.memory + CAPACITY_POLICY[item.kind].memory,
            disk: sum.disk + CAPACITY_POLICY[item.kind].disk,
          }),
          { memory: 0, disk: 0 },
        );
        const requested = CAPACITY_POLICY[next.kind];
        if (
          available.memory < reserved.memory + requested.memory + CAPACITY_POLICY.memoryHeadroom ||
          available.disk < reserved.disk + requested.disk + CAPACITY_POLICY.diskHeadroom
        ) {
          if (this.active.size) return;
          this.remove(next, new Error("Execution host memory or disk headroom is insufficient."));
          continue;
        }
        this.remove(next);
        const reservation = { kind: next.kind, scanId: next.scanId };
        this.active.add(reservation);
        next.resolve(() => {
          this.active.delete(reservation);
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }
}

export async function readHostCapacity(directory: string): Promise<HostCapacity> {
  const memory = await readFile("/proc/meminfo", "utf8");
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(memory);
  if (!match) throw new Error("Host memory accounting is unavailable.");
  const filesystem = await statfs(directory);
  return { memory: Number(match[1]) * 1024, disk: filesystem.bavail * filesystem.bsize };
}
