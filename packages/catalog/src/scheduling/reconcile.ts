import type { ProbePlan } from "@compatlab/contracts";
import { PreparationError, planProbes, runtimeProfile } from "@compatlab/engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import { allowedAssertion } from "../assertions/policy.js";
import { refreshWorkerAvailability } from "../availability.js";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { allowedSelection } from "../policy.js";
import { queueFinalReports } from "../reports/aggregate.js";
import {
  jobs,
  matrixMembers,
  preparations,
  runs,
  runtimeImages,
  scans,
  workers,
} from "../schema.js";
import { storableText } from "./storage.js";
import { databaseNow } from "./workers.js";

export async function advanceScan(
  tx: CatalogTransaction,
  scanId: string,
  now: Date,
): Promise<void> {
  const [row] = await tx
    .select({ scan: scans, preparation: preparations })
    .from(scans)
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .where(eq(scans.id, scanId));
  if (row?.scan.state === "aggregating") {
    await tx
      .insert(jobs)
      .values({ kind: "aggregation", scanId: row.scan.id })
      .onConflictDoNothing();
    return;
  }
  if (!row || !["requested", "preparing", "running"].includes(row.scan.state)) return;
  const { scan, preparation: prep } = row;
  if (prep.state === "ready" && !prep.snapshotAvailable) {
    await tx
      .update(scans)
      .set({
        state: "failed_infrastructure",
        finishedAt: now,
        progressRevision: sql`${scans.progressRevision}+1`,
      })
      .where(eq(scans.id, scan.id));
    await finishQueued(tx, scan.id, "runner_unavailable");
    return;
  }
  if (
    !(await allowedSelection(tx, prep.artifactId, scan.matrixId)) ||
    !(await allowedAssertion(tx, scan.assertionRevisionId))
  ) {
    await tx
      .update(scans)
      .set({
        state: "rejected",
        finishedAt: now,
        progressRevision: sql`${scans.progressRevision}+1`,
      })
      .where(eq(scans.id, scan.id));
    await finishQueued(tx, scan.id, "service_policy_rejected");
    return;
  }
  if (scan.deadlineAt && scan.deadlineAt <= now) {
    await tx
      .update(scans)
      .set({
        state: "inconclusive",
        finishedAt: now,
        progressRevision: sql`${scans.progressRevision}+1`,
      })
      .where(eq(scans.id, scan.id));
    await finishQueued(tx, scan.id, "scan_deadline");
    return;
  }
  if (prep.state === "preparing" && scan.state === "requested") {
    const [parent] = await tx
      .select({ startedAt: scans.startedAt, deadlineAt: scans.deadlineAt })
      .from(jobs)
      .innerJoin(scans, eq(scans.id, jobs.scanId))
      .where(and(eq(jobs.preparationId, prep.id), eq(jobs.kind, "preparation")));
    if (parent?.startedAt && parent.deadlineAt)
      await tx
        .update(scans)
        .set({
          state: "preparing",
          startedAt: parent.startedAt,
          deadlineAt: parent.deadlineAt,
          progressRevision: sql`${scans.progressRevision}+1`,
        })
        .where(eq(scans.id, scan.id));
  }
  if (prep.state === "pending" || prep.state === "preparing") return;
  if (prep.state === "ready" && !scan.startedAt) {
    const [owner] = prep.ownerWorkerId
      ? await tx.select().from(workers).where(eq(workers.id, prep.ownerWorkerId))
      : [];
    if (owner?.state !== "healthy" || owner.recoveryRequired || owner.revokedAt) {
      await tx
        .update(scans)
        .set({
          state: "failed_infrastructure",
          finishedAt: now,
          progressRevision: sql`${scans.progressRevision}+1`,
        })
        .where(eq(scans.id, scan.id));
      await finishQueued(tx, scan.id, "runner_unavailable");
      return;
    }
  }
  if (prep.state === "ready" && !scan.plan) {
    if (!prep.installedManifest || !prep.snapshotId) {
      await tx
        .update(scans)
        .set({
          state: "failed_infrastructure",
          finishedAt: now,
          progressRevision: sql`${scans.progressRevision}+1`,
        })
        .where(eq(scans.id, scan.id));
      return;
    }
    const images = await tx
      .select({ id: runtimeImages.id, profileId: runtimeImages.profileId })
      .from(matrixMembers)
      .innerJoin(runtimeImages, eq(runtimeImages.id, matrixMembers.imageId))
      .where(eq(matrixMembers.matrixId, scan.matrixId))
      .orderBy(matrixMembers.position);
    let plan: ProbePlan;
    try {
      plan = storableText(
        planProbes(
          Buffer.from(JSON.stringify(prep.installedManifest)),
          images.map((image) => runtimeProfile(image.profileId)),
        ),
      );
    } catch (error) {
      if (!(error instanceof PreparationError)) throw error;
      await tx
        .update(scans)
        .set({
          state: "aggregating",
          progressRevision: sql`${scans.progressRevision}+1`,
          diagnostics: {
            kind: "failure",
            origin: "preparation",
            phase: "static_analysis",
            classification: error.classification,
            message: error.message.slice(0, 2048),
          },
        })
        .where(eq(scans.id, scan.id));
      await tx
        .insert(jobs)
        .values({
          kind: "aggregation",
          scanId: scan.id,
          attemptSummary: {
            kind: "failure",
            origin: "preparation",
            phase: "static_analysis",
            classification: error.classification,
            message: error.message.slice(0, 2048),
          },
        })
        .onConflictDoNothing();
      return;
    }
    await tx
      .update(scans)
      .set({ plan, state: "running", progressRevision: sql`${scans.progressRevision}+1` })
      .where(eq(scans.id, scan.id));
    for (const image of images)
      for (const probeGroup of ["root", "subpaths"] as const)
        for (const mode of ["esm", "commonjs"] as const) {
          const [run] = await tx
            .insert(runs)
            .values({
              scanId: scan.id,
              matrixId: scan.matrixId,
              imageId: image.id,
              probeGroup,
              mode,
            })
            .onConflictDoNothing()
            .returning({ id: runs.id });
          if (run) await tx.insert(jobs).values({ kind: "run", runId: run.id, scanId: scan.id });
        }
    if (scan.assertionRevisionId)
      for (const image of images) {
        const [run] = await tx
          .insert(runs)
          .values({
            scanId: scan.id,
            matrixId: scan.matrixId,
            imageId: image.id,
            probeGroup: "root",
            mode: "esm",
            assertionRevisionId: scan.assertionRevisionId,
          })
          .onConflictDoNothing()
          .returning({ id: runs.id });
        if (run) await tx.insert(jobs).values({ kind: "run", runId: run.id, scanId: scan.id });
      }
  }
  if (prep.state === "ready") {
    const pending = (
      await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM jobs WHERE scan_id=${scan.id} AND kind='run' AND state<>'finished'`,
      )
    ).rows[0]?.count;
    if (pending) return;
  }
  await tx
    .update(scans)
    .set({ state: "aggregating", progressRevision: sql`${scans.progressRevision}+1` })
    .where(eq(scans.id, scan.id));
  await tx.insert(jobs).values({ kind: "aggregation", scanId: scan.id }).onConflictDoNothing();
}
async function finishQueued(tx: CatalogTransaction, scanId: string, classification: string) {
  await tx
    .update(jobs)
    .set({ state: "finished", attemptSummary: { classification } })
    .where(and(eq(jobs.scanId, scanId), eq(jobs.state, "queued")));
}
export async function reconcileCatalog(db: CatalogDatabase) {
  return catalogTransaction(db, async (tx) => {
    const now = await databaseNow(tx);
    await refreshWorkerAvailability(tx, now);
    await tx
      .update(workers)
      .set({ state: "drained", recoveryRequired: true })
      .where(
        and(
          eq(workers.state, "healthy"),
          sql`${workers.lastSeenAt} < ${new Date(now.getTime() - 30_000)}`,
        ),
      );
    const expired = await tx
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.state, ["leased", "running"]),
          eq(jobs.cleanupRequired, false),
          sql`${jobs.leaseExpiresAt} <= ${now}`,
        ),
      );
    for (const job of expired) {
      await tx.update(jobs).set({ cleanupRequired: true }).where(eq(jobs.id, job.id));
      if (job.workerId)
        await tx
          .update(workers)
          .set({ state: "drained", recoveryRequired: true })
          .where(and(eq(workers.id, job.workerId), sql`${workers.state} <> 'quarantined'`));
    }
    const active = await tx
      .select({ id: scans.id })
      .from(scans)
      .where(inArray(scans.state, ["requested", "preparing", "running", "aggregating"]))
      .orderBy(scans.requestedAt)
      .limit(100);
    for (const scan of active) await advanceScan(tx, scan.id, now);
    await queueFinalReports(tx);
    return { expiredAttempts: expired.length, inspectedScans: active.length };
  });
}
export async function scanProgress(db: CatalogDatabase, scanId: string) {
  const [scan] = await db
    .select({
      id: scans.id,
      state: scans.state,
      revision: scans.progressRevision,
      requestedAt: scans.requestedAt,
      startedAt: scans.startedAt,
      deadlineAt: scans.deadlineAt,
      finishedAt: scans.finishedAt,
      aggregationFailedAt: scans.aggregationFailedAt,
      reportId: sql<
        string | null
      >`(SELECT r.id FROM reports r WHERE r.scan_id=scans.id ORDER BY r.created_at DESC,r.id LIMIT 1)`,
      jobs: sql<{ queued: number; active: number; finished: number }>`(SELECT json_build_object(
        'queued',count(*) FILTER (WHERE j.state='queued'),
        'active',count(*) FILTER (WHERE j.state IN ('leased','running')),
        'finished',count(*) FILTER (WHERE j.state='finished')) FROM jobs j WHERE j.scan_id=scans.id)`,
    })
    .from(scans)
    .where(eq(scans.id, scanId));
  if (!scan) return null;
  return { schemaVersion: 1, ...scan };
}
