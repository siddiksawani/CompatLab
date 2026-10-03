import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { claimResponseSchema, type JobAssignment } from "@compatlab/contracts";
import { ExecutionSupervisor } from "../lifecycle/supervisor.js";
import { ControlClient } from "./client.js";
import { JobLease } from "./lease.js";
import { executeAssignment } from "./work.js";

export async function runWorker(options: {
  controlUrl: string;
  token: string;
  stateDirectory: string;
  signal: AbortSignal;
}) {
  const client = new ControlClient(options.controlUrl, options.token);
  const supervisor = await ExecutionSupervisor.open(options.stateDirectory);
  const sessionId = randomUUID();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([options.signal, cancellation.signal]);
  const active = new Set<Promise<void>>();
  let failure: unknown;
  try {
    await client.post("/v1/workers/ready", { sessionId }, signal);
    await supervisor.withScan(async (reservation) => {
      try {
        while (!signal.aborted) {
          if (active.size >= 3) {
            await Promise.race(active);
            continue;
          }
          const started = performance.now();
          const raw = await client.post("/v1/jobs/claim", { sessionId }, signal);
          const response = claimResponseSchema.parse(raw);
          supervisor.replaceSnapshotPins(response.snapshotIds, reservation);
          if (response.job === null) {
            await sleep(2000, undefined, { signal });
            continue;
          }
          const job = response.job;
          const operation = perform(job, started)
            .catch((error: unknown) => {
              if (!options.signal.aborted) failure ??= error;
              cancellation.abort(error);
            })
            .finally(() => active.delete(operation));
          active.add(operation);
        }
      } finally {
        cancellation.abort();
        await Promise.allSettled([...active]);
      }
    });
  } catch (error) {
    if (!options.signal.aborted) failure ??= error;
  } finally {
    cancellation.abort();
    await Promise.allSettled([...active]);
    await supervisor.close();
  }
  if (failure) throw failure;
  async function perform(job: JobAssignment, started: number) {
    const attempt = { sessionId, jobId: job.jobId, attemptToken: job.attemptToken };
    const lease = new JobLease(
      job.lease,
      started,
      (signal) => client.post("/v1/jobs/renew", attempt, signal),
      signal,
    );
    let accepted = false;
    try {
      lease.signal.throwIfAborted();
      const result = await executeAssignment(supervisor, job, lease.signal);
      lease.signal.throwIfAborted();
      const submission = { ...attempt, result };
      try {
        await client.post("/v1/jobs/results", submission, lease.signal);
      } catch {
        lease.signal.throwIfAborted();
        await client.post("/v1/jobs/results", submission, lease.signal);
      }
      accepted = true;
    } finally {
      lease.close();
      if (!accepted && !supervisor.capacity.blocked)
        await client
          .post("/v1/jobs/abandon", { ...attempt, cleanupConfirmed: true })
          .catch(() => undefined);
    }
  }
}
