import { createHash } from "node:crypto";
import { CLASSIFIER_REVISION } from "@compatlab/contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { admitScan } from "./admission.js";
import { type CatalogDatabase, catalogTransaction } from "./database.js";
import {
  auditEvents,
  blocks,
  jobs,
  matrices,
  packages,
  packageVersions,
  preparations,
  runs,
  runtimeImages,
  scans,
  serviceControls,
  workers,
} from "./schema.js";
import { type AdminAction, adminActionSchema, uuidSchema } from "./validation.js";

export async function setAdmissionPaused(
  db: CatalogDatabase,
  paused: boolean,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor);
  z.boolean().parse(paused);
  return catalogTransaction(db, async (tx) => {
    const changed = await tx
      .update(serviceControls)
      .set({ admissionPaused: paused })
      .where(eq(serviceControls.singleton, true))
      .returning();
    if (!changed.length) throw new TypeError("Service controls are unavailable.");
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: paused ? "admission_paused" : "admission_resumed", details: {} });
  });
}
export async function setWorkerState(
  db: CatalogDatabase,
  workerId: string,
  action: "drain" | "resume" | "quarantine" | "revoke",
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor);
  const id = uuidSchema.parse(workerId);
  z.enum(["drain", "resume", "quarantine", "revoke"]).parse(action);
  return catalogTransaction(db, async (tx) => {
    const [worker] = await tx.select().from(workers).where(eq(workers.id, id));
    if (!worker || worker.revokedAt) throw new TypeError("Worker unavailable.");
    if (action === "resume" && (worker.state === "quarantined" || worker.recoveryRequired))
      throw new TypeError("Reconcile or replace the worker before resuming admission.");
    await tx
      .update(workers)
      .set({
        acceptingJobs: action === "resume",
        ...(action === "quarantine" ? { state: "quarantined" as const } : {}),
        ...(action === "revoke" ? { revokedAt: new Date() } : {}),
      })
      .where(eq(workers.id, id));
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: `worker_${action}`, details: { workerId: id } });
  });
}
export async function setMatrixEnabled(
  db: CatalogDatabase,
  matrixId: string,
  enabled: boolean,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(matrixId);
  return catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(matrices)
      .set({ enabled: z.boolean().parse(enabled) })
      .where(eq(matrices.id, id))
      .returning({ id: matrices.id });
    if (!rows.length) throw new TypeError("Matrix not found.");
    await tx.insert(auditEvents).values({
      ...actor,
      action: enabled ? "matrix_enabled" : "matrix_disabled",
      details: { matrixId: id },
    });
  });
}
export async function retireWorker(db: CatalogDatabase, workerId: string, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(workerId);
  return catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(workers)
      .set({
        state: "quarantined",
        acceptingJobs: false,
        revokedAt: new Date(),
        recoveryRequired: true,
      })
      .where(eq(workers.id, id))
      .returning({ id: workers.id });
    if (!rows.length) throw new TypeError("Worker not found.");
    const lost = await tx
      .update(preparations)
      .set({ snapshotAvailable: false })
      .where(eq(preparations.ownerWorkerId, id))
      .returning({ id: preparations.id });
    await tx.execute(
      sql`UPDATE jobs j SET state=CASE WHEN j.kind='preparation' AND j.attempt<3 AND s.state IN ('requested','preparing','running') AND (s.deadline_at IS NULL OR s.deadline_at>clock_timestamp()) THEN 'queued' ELSE 'finished' END,cleanup_required=false,lease_expires_at=NULL,available_at=clock_timestamp(),attempt_summary='{"classification":"runner_unavailable","cleanupConfirmed":true,"operatorFenced":true}'::jsonb FROM scans s WHERE j.scan_id=s.id AND j.worker_id=${id} AND j.state IN ('leased','running')`,
    );
    await tx.execute(
      sql`UPDATE preparations p SET state='failed_infrastructure',diagnostics='{"kind":"failure","origin":"infrastructure","classification":"runner_unavailable","message":"Execution host was retired."}'::jsonb WHERE p.owner_worker_id=${id} AND p.state IN ('pending','preparing') AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.preparation_id=p.id AND j.kind='preparation' AND j.state='queued')`,
    );
    await tx.insert(auditEvents).values({
      ...actor,
      action: "worker_retired",
      details: {
        workerId: id,
        hostDestructionConfirmed: true,
        unavailablePreparations: lost.length,
      },
    });
  });
}
export async function revokeBlock(db: CatalogDatabase, blockId: string, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(blockId);
  return catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(blocks)
      .set({ revokedAt: new Date() })
      .where(and(eq(blocks.id, id), isNull(blocks.revokedAt)))
      .returning({ id: blocks.id });
    if (!rows.length) throw new TypeError("Active block not found.");
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: "block_revoked", details: { blockId: id } });
  });
}
export async function approveRuntime(db: CatalogDatabase, imageId: string, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(imageId);
  return catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(runtimeImages)
      .set({ state: "approved" })
      .where(eq(runtimeImages.id, id))
      .returning({ id: runtimeImages.id });
    if (!rows.length) throw new TypeError("Runtime image not found.");
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: "runtime_approved", details: { imageId: id } });
  });
}
export async function cancelScan(db: CatalogDatabase, scanId: string, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(scanId);
  return catalogTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ scan: scans, prep: preparations })
      .from(scans)
      .innerJoin(preparations, eq(preparations.id, scans.preparationId))
      .where(eq(scans.id, id));
    if (!row) throw new TypeError("Scan not found.");
    if (!["requested", "preparing", "running", "aggregating"].includes(row.scan.state))
      throw new TypeError("Scan is already terminal.");
    const shared = ["pending", "preparing"].includes(row.prep.state);
    const affected = await tx
      .update(scans)
      .set({
        state: "cancelled",
        finishedAt: new Date(),
        progressRevision: sql`${scans.progressRevision}+1`,
      })
      .where(
        and(
          shared ? eq(scans.preparationId, row.prep.id) : eq(scans.id, id),
          inArray(scans.state, ["requested", "preparing", "running", "aggregating"]),
        ),
      )
      .returning({ id: scans.id });
    const ids = affected.map((row) => row.id);
    if (shared)
      await tx
        .update(preparations)
        .set({
          state: "failed_infrastructure",
          diagnostics: {
            kind: "failure",
            origin: "infrastructure",
            classification: "job_cancelled",
            message: "Operator cancelled shared preparation.",
          },
        })
        .where(eq(preparations.id, row.prep.id));
    await tx
      .update(jobs)
      .set({ state: "finished", attemptSummary: { classification: "job_cancelled" } })
      .where(
        and(inArray(jobs.scanId, ids), eq(jobs.state, "queued"), sql`${jobs.kind}<>'aggregation'`),
      );
    await tx
      .update(jobs)
      .set({ cleanupRequired: true })
      .where(and(inArray(jobs.scanId, ids), inArray(jobs.state, ["leased", "running"])));
    await tx.insert(auditEvents).values({
      ...actor,
      action: "scan_cancelled",
      details: { scanId: id, affectedScanIds: ids, sharedPreparation: shared },
    });
    return { affectedScanIds: ids };
  });
}
export async function retryInfrastructure(
  db: CatalogDatabase,
  scanId: string,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(scanId);
  const [row] = await db
    .select({ matrixId: scans.matrixId, name: packages.name, artifact: packageVersions })
    .from(scans)
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .innerJoin(packageVersions, eq(packageVersions.id, preparations.artifactId))
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(eq(scans.id, id));
  if (!row) throw new TypeError("Scan not found.");
  return admitScan(
    db,
    { ...row.artifact, name: row.name },
    {
      matrixId: row.matrixId,
      classifierRevision: CLASSIFIER_REVISION,
      requesterKey: createHash("sha256").update(`operator:${actor.actor}`).digest("hex"),
      retry: { ...actor, scanId: id },
    },
  );
}
export async function applyRetention(db: CatalogDatabase, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor);
  return catalogTransaction(db, async (tx) => {
    const logs = await tx.execute(
      sql`UPDATE runs SET logs=NULL WHERE id IN (SELECT id FROM runs WHERE logs IS NOT NULL AND logs_expire_at < clock_timestamp() ORDER BY logs_expire_at LIMIT 1000) RETURNING id`,
    );
    const requesters = await tx.execute(
      sql`UPDATE scans SET requester_key=NULL WHERE id IN (SELECT id FROM scans WHERE requester_key IS NOT NULL AND requester_expires_at < clock_timestamp() ORDER BY requester_expires_at LIMIT 1000) RETURNING id`,
    );
    const audits = await tx.execute(
      sql`DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE created_at < clock_timestamp()-interval '180 days' ORDER BY created_at LIMIT 1000) RETURNING id`,
    );
    const counts = {
      logs: logs.rowCount ?? 0,
      requesters: requesters.rowCount ?? 0,
      audits: audits.rowCount ?? 0,
    };
    if (Object.values(counts).some(Boolean))
      await tx
        .insert(auditEvents)
        .values({ ...actor, action: "retention_applied", details: counts });
    return counts;
  });
}
export async function removeScanLogs(db: CatalogDatabase, scanId: string, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor),
    id = uuidSchema.parse(scanId);
  return catalogTransaction(db, async (tx) => {
    const [scan] = await tx
      .select({ id: scans.id, state: scans.state })
      .from(scans)
      .where(eq(scans.id, id));
    if (!scan || ["requested", "preparing", "running", "aggregating"].includes(scan.state))
      throw new TypeError("Log removal requires a terminal scan.");
    const changed = await tx
      .update(runs)
      .set({ logs: null, logsExpireAt: new Date() })
      .where(eq(runs.scanId, id))
      .returning({ id: runs.id });
    await tx.insert(auditEvents).values({
      ...actor,
      action: "scan_logs_removed",
      details: { scanId: id, runs: changed.length },
    });
    return { runs: changed.length };
  });
}
export async function operationStatus(db: CatalogDatabase) {
  const [queue, workerRows, health, retention] = await Promise.all([
    db.execute(
      sql`SELECT state,count(*)::int AS count,coalesce(max(extract(epoch FROM clock_timestamp()-requested_at))::int,0) AS "oldestSeconds" FROM scans WHERE state IN ('requested','preparing','running','aggregating') GROUP BY state`,
    ),
    db.execute(
      sql`SELECT id,state,accepting_jobs AS "acceptingJobs",capacity,last_seen_at AS "lastSeenAt",recovery_required AS "recoveryRequired",revoked_at AS "revokedAt",(SELECT count(*)::int FROM jobs j WHERE j.worker_id=w.id AND j.cleanup_required) AS "cleanupPending" FROM workers w ORDER BY created_at DESC LIMIT 100`,
    ),
    db.execute(
      sql`SELECT pg_database_size(current_database())::text AS "databaseBytes",(SELECT admission_paused FROM service_controls WHERE singleton) AS "admissionPaused",(SELECT count(*)::int FROM scans WHERE requested_at>now()-interval '24 hours' AND state='failed_infrastructure') AS "infrastructureFailures24h",(SELECT count(*)::int FROM scans WHERE requested_at>now()-interval '24 hours') AS "scans24h",(SELECT count(*)::int FROM preparations WHERE snapshot_available) AS "availableSnapshots",(SELECT max(created_at) FROM audit_events WHERE action='backup_uploaded') AS "lastBackupAt"`,
    ),
    db.execute(
      sql`SELECT (SELECT count(*)::int FROM runs WHERE logs IS NOT NULL AND logs_expire_at<now()) AS "expiredLogs",(SELECT count(*)::int FROM scans WHERE requester_key IS NOT NULL AND requester_expires_at<now()) AS "expiredRequesters",(SELECT count(*)::int FROM audit_events WHERE created_at<now()-interval '180 days') AS "expiredAudits"`,
    ),
  ]);
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    queue: queue.rows,
    workers: workerRows.rows,
    health: health.rows[0],
    retention: retention.rows[0],
  };
}
export async function auditBackup(
  db: CatalogDatabase,
  digest: string,
  bytes: number,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(digest);
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(bytes);
  await catalogTransaction(db, async (tx) => {
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: "backup_uploaded", details: { digest, bytes } });
  });
}
