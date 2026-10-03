import { leaseSchema } from "@compatlab/contracts";

export class JobLease {
  private readonly cancellation = new AbortController();
  private deadline: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private stopped = false;
  readonly signal: AbortSignal;
  constructor(
    initial: unknown,
    requestStartedAt: number,
    private readonly renew: (signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
  ) {
    this.signal = AbortSignal.any([signal, this.cancellation.signal]);
    this.update(initial, requestStartedAt);
    this.schedule();
  }
  private update(rawLease: unknown, requestStartedAt: number) {
    const lease = leaseSchema.parse(rawLease);
    const remaining =
      requestStartedAt +
      Math.min(lease.remainingMs, lease.scanRemainingMs) -
      performance.now() -
      3000;
    clearTimeout(this.deadline);
    if (remaining <= 0) {
      this.cancellation.abort(new Error("Job lease expired."));
      return;
    }
    this.deadline = setTimeout(
      () => this.cancellation.abort(new Error("Job lease expired.")),
      remaining,
    );
  }
  private schedule() {
    if (this.stopped || this.signal.aborted) return;
    this.heartbeat = setTimeout(() => {
      const started = performance.now();
      this.renew(this.signal)
        .then((lease) => {
          if (!this.stopped) this.update(lease, started);
        })
        .catch((error: unknown) => {
          if (!this.stopped) this.cancellation.abort(error);
        })
        .finally(() => this.schedule());
    }, 10_000);
  }
  close() {
    this.stopped = true;
    clearTimeout(this.deadline);
    clearTimeout(this.heartbeat);
    this.cancellation.abort();
  }
}
