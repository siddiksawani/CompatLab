import { randomUUID } from "node:crypto";
import {
  attemptSchema,
  type JobAssignment,
  jobAssignmentSchema,
  jobEvidenceBudget,
  workerSessionSchema,
} from "@compatlab/contracts";
import { and, eq, sql } from "drizzle-orm";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { allowedSelection, selectionAllowed } from "../policy.js";
import {
  jobs,
  matrices,
  packages,
  packageVersions,
  preparations,
  runs,
  runtimeImages,
  scans,
  workers,
} from "../schema.js";
import { activeWorker, databaseNow, SCHEDULER_POLICY, SchedulingError } from "./workers.js";

export async function claimJob(
  db: CatalogDatabase,
  token: string,
  rawSession: unknown,
): Promise<JobAssignment | null> {
  const { sessionId } = workerSessionSchema.parse(rawSession);
  return catalogTransaction(db, async (tx) => {
    const worker = await activeWorker(tx, token, sessionId);
    const now = await databaseNow(tx);
    await tx.update(workers).set({ lastSeenAt: now }).where(eq(workers.id, worker.id));
    const { capabilities: caps } = worker;
    const selected = (
      await tx.execute<{ id: string }>(sql`
      SELECT j.id FROM jobs j JOIN scans s ON s.id=j.scan_id
      JOIN preparations prep ON prep.id=s.preparation_id
      JOIN matrices m ON m.id=s.matrix_id
      JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id
      LEFT JOIN runs r ON r.id=j.run_id LEFT JOIN runtime_images ri ON ri.id=r.image_id
      WHERE j.state='queued' AND NOT j.cleanup_required AND j.attempt < 3 AND j.available_at <= ${now}
        AND s.state IN ('requested','preparing','running') AND (s.deadline_at IS NULL OR s.deadline_at > ${now})
        AND ${selectionAllowed} AND m.platform=${caps.platform}
        AND m.harness_revision=${caps.harnessRevision} AND m.plan_revision=${caps.planRevision} AND m.policy_revision=${caps.policyRevision}
        AND (SELECT count(*) FROM jobs WHERE state IN ('leased','running')) < ${SCHEDULER_POLICY.globalJobs}
        AND (SELECT count(*) FROM jobs WHERE state IN ('leased','running') AND worker_id=${worker.id}) < ${worker.capacity}
        AND (
          (j.kind='preparation' AND prep.state IN ('pending','preparing')
            AND ${JSON.stringify(caps.preparationProfiles)}::jsonb ? prep.profile_revision
            AND NOT EXISTS (SELECT 1 FROM matrix_members mm JOIN runtime_images mi ON mi.id=mm.image_id WHERE mm.matrix_id=m.id AND NOT (${JSON.stringify(caps.imageDigests)}::jsonb ? mi.image_digest))
            AND (SELECT count(*) FROM jobs WHERE state IN ('leased','running') AND kind='preparation') < ${SCHEDULER_POLICY.preparations})
          OR (j.kind='run' AND prep.state='ready' AND prep.snapshot_available AND prep.owner_worker_id=${worker.id}
            AND prep.snapshot_id IS NOT NULL AND ${JSON.stringify(caps.imageDigests)}::jsonb ? ri.image_digest
            AND (SELECT count(*) FROM jobs busy JOIN runs br ON br.id=busy.run_id WHERE busy.state IN ('leased','running') AND br.image_id=r.image_id) < ${SCHEDULER_POLICY.perImage})
        )
      ORDER BY (SELECT count(*) FROM jobs busy WHERE busy.scan_id=s.id AND busy.state IN ('leased','running')), s.requested_at,j.created_at,j.id
      LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)
    ).rows[0];
    if (!selected) return null;
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, selected.id));
    if (!job) throw new Error("Claimed job missing.");
    const [scan] = await tx.select().from(scans).where(eq(scans.id, job.scanId));
    if (!scan) throw new Error("Claimed scan missing.");
    const deadline = scan.deadlineAt ?? new Date(now.getTime() + 900_000);
    const attemptToken = randomUUID();
    const expiry = new Date(Math.min(now.getTime() + SCHEDULER_POLICY.leaseMs, deadline.getTime()));
    await tx
      .update(scans)
      .set({
        startedAt: scan.startedAt ?? now,
        deadlineAt: deadline,
        state: job.kind === "preparation" ? "preparing" : "running",
        progressRevision: sql`${scans.progressRevision}+1`,
      })
      .where(eq(scans.id, scan.id));
    await tx
      .update(jobs)
      .set({
        state: "leased",
        attempt: job.attempt + 1,
        attemptToken,
        workerId: worker.id,
        sessionId,
        leaseExpiresAt: expiry,
        deadlineAt: deadline,
        resultDigest: null,
      })
      .where(eq(jobs.id, job.id));
    if (job.kind === "preparation")
      await tx
        .update(preparations)
        .set({ state: "preparing", ownerWorkerId: worker.id })
        .where(eq(preparations.id, scan.preparationId));
    return assignment(tx, job.id, {
      remainingMs: expiry.getTime() - now.getTime(),
      scanRemainingMs: deadline.getTime() - now.getTime(),
    });
  });
}
async function assignment(
  tx: CatalogTransaction,
  jobId: string,
  lease: JobAssignment["lease"],
): Promise<JobAssignment> {
  const [row] = await tx
    .select({
      job: jobs,
      scan: scans,
      preparation: preparations,
      artifact: packageVersions,
      name: packages.name,
      matrix: matrices,
    })
    .from(jobs)
    .innerJoin(scans, eq(scans.id, jobs.scanId))
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .innerJoin(packageVersions, eq(packageVersions.id, preparations.artifactId))
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .innerJoin(matrices, eq(matrices.id, scans.matrixId))
    .where(eq(jobs.id, jobId));
  if (!row) throw new Error("Job input missing.");
  const common = {
    schemaVersion: 1,
    jobId,
    scanId: row.scan.id,
    preparationId: row.preparation.id,
    attemptToken: row.job.attemptToken,
    attempt: row.job.attempt,
    lease,
    artifact: {
      name: row.name,
      version: row.artifact.version,
      integrity: row.artifact.integrity,
      tarballUrl: row.artifact.tarballUrl,
    },
  };
  if (row.job.kind === "preparation")
    return jobAssignmentSchema.parse({
      ...common,
      kind: "preparation",
      profileRevision: row.preparation.profileRevision,
    });
  if (!row.job.runId) throw new Error("Run identity missing.");
  const [run] = await tx
    .select({ run: runs, image: runtimeImages.definition })
    .from(runs)
    .innerJoin(runtimeImages, eq(runtimeImages.id, runs.imageId))
    .where(eq(runs.id, row.job.runId));
  if (!run) throw new Error("Run image missing.");
  const prep = row.preparation;
  if (!row.scan.plan) throw new Error("Run plan missing.");
  return jobAssignmentSchema.parse({
    ...common,
    kind: "run",
    image: run.image,
    group: run.run.probeGroup,
    mode: run.run.mode,
    plan: row.scan.plan,
    snapshot: {
      id: prep.snapshotId,
      generation: prep.snapshotGeneration,
      lockDigest: prep.lockDigest,
      treeDigest: prep.treeDigest,
      profileRevision: prep.profileRevision,
      installerImage: prep.installerImage,
    },
    ...jobEvidenceBudget(row.scan.plan, prep.metadata, row.matrix.runtimeCount),
  });
}
export async function renewJob(db: CatalogDatabase, token: string, rawAttempt: unknown) {
  const attempt = attemptSchema.parse(rawAttempt);
  return catalogTransaction(db, async (tx) => {
    const worker = await activeWorker(tx, token, attempt.sessionId);
    const now = await databaseNow(tx);
    const { job, scan, preparation } = await currentAttempt(tx, worker.id, attempt, now);
    if (!(await allowedSelection(tx, preparation.artifactId, scan.matrixId)))
      throw new SchedulingError("stale_attempt", "The execution policy changed.");
    const expiry = new Date(
      Math.min(now.getTime() + 30_000, job.deadlineAt?.getTime() ?? now.getTime()),
    );
    await tx
      .update(jobs)
      .set({ state: "running", leaseExpiresAt: expiry })
      .where(eq(jobs.id, job.id));
    await tx.update(workers).set({ lastSeenAt: now }).where(eq(workers.id, worker.id));
    return {
      remainingMs: expiry.getTime() - now.getTime(),
      scanRemainingMs: (job.deadlineAt?.getTime() ?? now.getTime()) - now.getTime(),
    };
  });
}

export async function workerSnapshotPins(db: CatalogDatabase, token: string, rawSession: unknown) {
  const { sessionId } = workerSessionSchema.parse(rawSession);
  return catalogTransaction(db, async (tx) => {
    const worker = await activeWorker(tx, token, sessionId);
    const rows = (
      await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT p.snapshot_id AS id FROM preparations p JOIN scans s ON s.preparation_id=p.id
      WHERE p.owner_worker_id=${worker.id} AND p.snapshot_id IS NOT NULL
        AND s.state IN ('requested','preparing','running','aggregating') LIMIT 129`)
    ).rows;
    if (rows.length > 128)
      throw new SchedulingError(
        "worker_unavailable",
        "Active snapshot reservations exceed the worker limit.",
      );
    return rows.map((row) => row.id);
  });
}
export async function currentAttempt(
  tx: CatalogTransaction,
  workerId: string,
  attempt: { sessionId: string; jobId: string; attemptToken: string },
  now: Date,
  allowFinished = false,
) {
  const [row] = await tx
    .select({ job: jobs, scan: scans, preparation: preparations })
    .from(jobs)
    .innerJoin(scans, eq(scans.id, jobs.scanId))
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .where(
      and(
        eq(jobs.id, attempt.jobId),
        eq(jobs.workerId, workerId),
        eq(jobs.sessionId, attempt.sessionId),
        eq(jobs.attemptToken, attempt.attemptToken),
      ),
    );
  if (!row) throw new SchedulingError("stale_attempt", "Job attempt is no longer authorized.");
  if (allowFinished && row.job.resultDigest) return row;
  if (
    !["leased", "running"].includes(row.job.state) ||
    row.job.cleanupRequired ||
    !row.job.leaseExpiresAt ||
    row.job.leaseExpiresAt <= now ||
    !row.job.deadlineAt ||
    row.job.deadlineAt <= now ||
    !["preparing", "running"].includes(row.scan.state)
  )
    throw new SchedulingError("stale_attempt", "Job lease expired or the scan stopped.");
  return row;
}
