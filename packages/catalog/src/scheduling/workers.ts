import { createHash, randomBytes } from "node:crypto";
import {
  attemptSchema,
  workerCapabilitiesSchema,
  workerInventorySchema,
} from "@compatlab/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { auditEvents, jobs, workers } from "../schema.js";
import { type AdminAction, adminActionSchema } from "../validation.js";

export class SchedulingError extends Error {
  override readonly name = "SchedulingError";
  constructor(
    readonly code: "unauthorized" | "stale_attempt" | "worker_unavailable" | "invalid_result",
    message: string,
  ) {
    super(message);
  }
}
export const SCHEDULER_POLICY = {
  revision: "scheduler_v1",
  leaseMs: 30_000,
  heartbeatMs: 10_000,
  globalJobs: 3,
  preparations: 1,
  perImage: 2,
  maxAttempts: 3,
} as const;
export async function databaseNow(tx: CatalogTransaction): Promise<Date> {
  const value = (
    await tx.execute<{ millis: string }>(
      sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS millis`,
    )
  ).rows[0];
  if (!value) throw new Error("Database time unavailable.");
  return new Date(Number(value.millis));
}
function tokenHash(token: string): string {
  if (!/^clw_[A-Za-z0-9_-]{43}$/.test(token))
    throw new SchedulingError("unauthorized", "Worker authentication failed.");
  return createHash("sha256").update(token).digest("hex");
}
export async function authenticatedWorker(db: CatalogDatabase | CatalogTransaction, token: string) {
  const [worker] = await db
    .select()
    .from(workers)
    .where(and(eq(workers.tokenHash, tokenHash(token)), isNull(workers.revokedAt)));
  if (!worker) throw new SchedulingError("unauthorized", "Worker authentication failed.");
  return worker;
}
export async function activeWorker(tx: CatalogTransaction, token: string, sessionId: string) {
  const worker = await authenticatedWorker(tx, token);
  if (worker.sessionId !== sessionId || worker.recoveryRequired || worker.state !== "healthy")
    throw new SchedulingError("worker_unavailable", "Worker must reconcile before claiming work.");
  return { ...worker, capabilities: workerCapabilitiesSchema.parse(worker.capabilities) };
}
export async function registerWorker(
  db: CatalogDatabase,
  capabilities: unknown,
  capacity: number,
  rawActor: AdminAction,
) {
  const definition = workerCapabilitiesSchema.parse(capabilities);
  const actor = adminActionSchema.parse(rawActor);
  z.number().int().min(1).max(3).parse(capacity);
  const token = `clw_${randomBytes(32).toString("base64url")}`;
  return catalogTransaction(db, async (tx) => {
    const [worker] = await tx
      .insert(workers)
      .values({ tokenHash: tokenHash(token), capabilities: definition, capacity })
      .returning({ id: workers.id });
    if (!worker) throw new Error("Worker registration failed.");
    await tx.insert(auditEvents).values({
      ...actor,
      action: "worker_registered",
      details: { workerId: worker.id, capacity },
    });
    return { workerId: worker.id, token };
  });
}
export async function readyWorker(db: CatalogDatabase, token: string, rawSession: unknown) {
  const { sessionId, snapshotIds } = workerInventorySchema
    .partial({ snapshotIds: true })
    .parse(rawSession);
  return catalogTransaction(db, async (tx) => {
    const worker = await authenticatedWorker(tx, token);
    if (worker.state === "quarantined")
      throw new SchedulingError("worker_unavailable", "Worker is quarantined.");
    if (worker.state === "drained" && !worker.recoveryRequired)
      throw new SchedulingError("worker_unavailable", "Worker is administratively drained.");
    const now = await databaseNow(tx);
    if (worker.sessionId === sessionId && !worker.recoveryRequired && worker.state === "healthy")
      return { workerId: worker.id };
    if (worker.sessionId === sessionId)
      throw new SchedulingError(
        "worker_unavailable",
        "Recovery requires a new supervisor session.",
      );
    if (
      worker.sessionId &&
      !worker.recoveryRequired &&
      worker.lastSeenAt &&
      now.getTime() - worker.lastSeenAt.getTime() < 30_000
    )
      throw new SchedulingError(
        "worker_unavailable",
        "The previous supervisor session is still active.",
      );
    const pending = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.workerId, worker.id), sql`${jobs.state} IN ('leased','running')`));
    for (const job of pending) {
      const [scan] = (
        await tx.execute<{ state: string; deadline: string | null }>(
          sql`SELECT state, deadline_at AS deadline FROM scans WHERE id=${job.scanId}`,
        )
      ).rows;
      const retry =
        job.attempt < 3 &&
        scan &&
        ["requested", "preparing", "running"].includes(scan.state) &&
        (!scan.deadline || new Date(scan.deadline) > now);
      await tx
        .update(jobs)
        .set({
          state: retry ? "queued" : "finished",
          cleanupRequired: false,
          availableAt: now,
          attemptSummary: { classification: "runner_unavailable", cleanupConfirmed: true },
          leaseExpiresAt: null,
        })
        .where(eq(jobs.id, job.id));
      if (!retry && job.kind === "preparation")
        await tx.execute(
          sql`UPDATE preparations SET state='failed_infrastructure',diagnostics='{"kind":"failure","origin":"infrastructure","classification":"runner_unavailable","message":"Preparation attempts ended before accepted evidence."}'::jsonb WHERE id=${job.preparationId} AND state IN ('pending','preparing')`,
        );
      if (!retry)
        await tx.execute(
          sql`UPDATE scans SET state='failed_infrastructure',finished_at=${now},progress_revision=progress_revision+1 WHERE id=${job.scanId} AND state IN ('requested','preparing','running','aggregating')`,
        );
      else
        await tx.execute(
          sql`UPDATE scans SET progress_revision=progress_revision+1 WHERE id=${job.scanId}`,
        );
    }
    await reconcileSnapshotInventory(tx, worker.id, snapshotIds ?? []);
    await tx
      .update(workers)
      .set({ sessionId, state: "healthy", recoveryRequired: false, lastSeenAt: now })
      .where(eq(workers.id, worker.id));
    await tx.insert(auditEvents).values({
      actor: `worker:${worker.id}`,
      action: "worker_reconciled",
      reason: "Supervisor confirmed local cleanup before starting this session.",
      details: { sessionId, abandonedAttempts: pending.length },
    });
    return { workerId: worker.id };
  });
}

async function reconcileSnapshotInventory(
  tx: CatalogTransaction,
  workerId: string,
  snapshotIds: readonly string[],
) {
  await tx.execute(
    sql`UPDATE preparations SET snapshot_available=false WHERE owner_worker_id=${workerId} AND snapshot_available AND snapshot_id IS NOT NULL AND NOT (${JSON.stringify(snapshotIds)}::jsonb ? snapshot_id::text)`,
  );
}

export async function authorizeSnapshotEviction(
  db: CatalogDatabase,
  token: string,
  rawInventory: unknown,
) {
  const { sessionId, snapshotIds } = workerInventorySchema.parse(rawInventory);
  return catalogTransaction(db, async (tx) => {
    const worker = await activeWorker(tx, token, sessionId);
    const reserved = (
      await tx.execute<{
        id: string;
      }>(sql`SELECT DISTINCT p.snapshot_id AS id FROM preparations p JOIN scans s ON s.preparation_id=p.id
      WHERE p.owner_worker_id=${worker.id} AND p.snapshot_id IS NOT NULL AND (
        s.state IN ('requested','preparing','running','aggregating') OR EXISTS (SELECT 1 FROM jobs j WHERE j.scan_id=s.id AND j.state IN ('leased','running'))
      )`)
    ).rows;
    const protectedIds = new Set(reserved.map((row) => row.id));
    const evictable = [...new Set(snapshotIds)].filter((id) => !protectedIds.has(id));
    await tx.execute(
      sql`UPDATE preparations SET snapshot_available=false WHERE owner_worker_id=${worker.id} AND snapshot_available AND ${JSON.stringify(evictable)}::jsonb ? snapshot_id::text`,
    );
    return { snapshotIds: evictable };
  });
}

export async function abandonAttempt(db: CatalogDatabase, token: string, rawAttempt: unknown) {
  const attempt = attemptSchema.extend({ cleanupConfirmed: z.literal(true) }).parse(rawAttempt);
  return catalogTransaction(db, async (tx) => {
    const worker = await authenticatedWorker(tx, token);
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, attempt.jobId),
          eq(jobs.workerId, worker.id),
          eq(jobs.sessionId, attempt.sessionId),
          eq(jobs.attemptToken, attempt.attemptToken),
        ),
      );
    if (!job) throw new SchedulingError("stale_attempt", "Attempt is no longer current.");
    if (job.state === "finished" || job.state === "queued") return { released: true };
    const now = await databaseNow(tx);
    const [scan] = (
      await tx.execute<{ state: string }>(sql`SELECT state FROM scans WHERE id=${job.scanId}`)
    ).rows;
    const retry =
      job.attempt < 3 &&
      (job.deadlineAt?.getTime() ?? 0) > now.getTime() &&
      scan &&
      ["requested", "preparing", "running"].includes(scan.state);
    await tx
      .update(jobs)
      .set({
        state: retry ? "queued" : "finished",
        availableAt: new Date(now.getTime() + 5000),
        cleanupRequired: false,
        leaseExpiresAt: null,
        attemptSummary: { classification: "runner_unavailable", cleanupConfirmed: true },
      })
      .where(eq(jobs.id, job.id));
    if (!retry && job.kind === "preparation")
      await tx.execute(
        sql`UPDATE preparations SET state='failed_infrastructure',diagnostics='{"kind":"failure","origin":"infrastructure","classification":"runner_unavailable","message":"Worker attempt ended without accepted evidence."}'::jsonb WHERE id=${job.preparationId} AND state IN ('pending','preparing')`,
      );
    await tx.execute(
      sql`UPDATE scans SET progress_revision=progress_revision+1 WHERE id=${job.scanId}`,
    );
    return { released: true };
  });
}
