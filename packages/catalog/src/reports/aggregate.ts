import { createHash } from "node:crypto";
import { CLASSIFIER_REVISION } from "@compatlab/contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { databaseNow } from "../scheduling/workers.js";
import { auditEvents, jobs, reports, scans } from "../schema.js";
import { type AdminAction, adminActionSchema } from "../validation.js";
import { buildReport } from "./build.js";

async function persistReport(tx: CatalogTransaction, scanId: string) {
  const [existing] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.scanId, scanId), eq(reports.classifierRevision, CLASSIFIER_REVISION)));
  if (existing) {
    await tx
      .update(jobs)
      .set({
        state: "finished",
        attemptSummary: { reportId: existing.id, classifierRevision: CLASSIFIER_REVISION },
      })
      .where(and(eq(jobs.scanId, scanId), eq(jobs.kind, "aggregation"), eq(jobs.state, "queued")));
    return existing.id;
  }
  const now = await databaseNow(tx);
  const payload = await buildReport(tx, scanId, now);
  const previous = await tx
    .select()
    .from(reports)
    .where(eq(reports.scanId, scanId))
    .orderBy(sql`${reports.createdAt} DESC`)
    .limit(1);
  await tx.insert(reports).values({
    id: payload.id,
    scanId,
    classifierRevision: CLASSIFIER_REVISION,
    payload,
    invalidatedAt: previous[0]?.invalidatedAt ?? null,
    invalidationReason: previous[0]?.invalidationReason ?? null,
  });
  await tx
    .update(reports)
    .set({ replacedBy: payload.id })
    .where(
      and(
        eq(reports.scanId, scanId),
        isNull(reports.replacedBy),
        sql`${reports.id}<>${payload.id}`,
      ),
    );
  await tx
    .update(scans)
    .set({
      state: payload.outcome === "infrastructure_error" ? "failed_infrastructure" : "completed",
      finishedAt: now,
    })
    .where(and(eq(scans.id, scanId), eq(scans.state, "aggregating")));
  await tx
    .update(scans)
    .set({ progressRevision: sql`${scans.progressRevision}+1` })
    .where(eq(scans.id, scanId));
  await tx
    .update(jobs)
    .set({
      state: "finished",
      resultDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      attemptSummary: { reportId: payload.id, classifierRevision: CLASSIFIER_REVISION },
    })
    .where(and(eq(jobs.scanId, scanId), eq(jobs.kind, "aggregation")));
  return payload.id;
}

export async function aggregatePendingReports(db: CatalogDatabase, limit = 10) {
  z.number().int().min(1).max(100).parse(limit);
  const pending = await db
    .select({ id: jobs.id, scanId: jobs.scanId })
    .from(jobs)
    .where(
      and(eq(jobs.kind, "aggregation"), eq(jobs.state, "queued"), sql`${jobs.availableAt}<=now()`),
    )
    .orderBy(jobs.createdAt)
    .limit(limit);
  let completed = 0,
    failed = 0;
  for (const job of pending) {
    const result = await catalogTransaction(db, async (tx) => {
      const [current] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, job.id), eq(jobs.state, "queued"), sql`${jobs.availableAt}<=now()`));
      if (!current) return "skipped";
      try {
        await tx.transaction((attempt) => persistReport(attempt, job.scanId));
        return "completed";
      } catch {
        await tx.execute(sql`UPDATE jobs SET attempt=least(attempt+1,3),state=CASE WHEN attempt>=2 THEN 'finished' ELSE 'queued' END,
          available_at=now()+interval '10 seconds',attempt_summary='{"classification":"control_plane_error"}'::jsonb
          WHERE id=${job.id} AND state='queued'`);
        await tx.execute(sql`UPDATE scans SET state='failed_infrastructure',finished_at=now(),progress_revision=progress_revision+1
          WHERE id=${job.scanId} AND state='aggregating' AND EXISTS (SELECT 1 FROM jobs WHERE id=${job.id} AND attempt=3)`);
        return "failed";
      }
    });
    if (result === "completed") completed++;
    if (result === "failed") failed++;
  }
  return { completed, failed };
}

export async function queueFinalReports(tx: CatalogTransaction) {
  const terminal = await tx
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        inArray(scans.state, [
          "completed",
          "inconclusive",
          "failed_infrastructure",
          "rejected",
          "cancelled",
        ]),
        sql`NOT EXISTS (SELECT 1 FROM jobs j WHERE j.scan_id=scans.id AND j.kind='aggregation')`,
      ),
    )
    .orderBy(scans.requestedAt)
    .limit(100);
  for (const scan of terminal) {
    const created = await tx
      .insert(jobs)
      .values({ kind: "aggregation", scanId: scan.id })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    if (created.length)
      await tx
        .update(scans)
        .set({ progressRevision: sql`${scans.progressRevision}+1` })
        .where(eq(scans.id, scan.id));
  }
}

export async function reclassifyScan(db: CatalogDatabase, scanId: string, rawActor: AdminAction) {
  z.uuid().parse(scanId);
  const actor = adminActionSchema.parse(rawActor);
  return catalogTransaction(db, async (tx) => {
    const reportId = await persistReport(tx, scanId);
    await tx.insert(auditEvents).values({
      ...actor,
      action: "scan_reclassified",
      details: { scanId, reportId, classifierRevision: CLASSIFIER_REVISION },
    });
    return reportId;
  });
}
