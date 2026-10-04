import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "./database.js";
import { databaseNow } from "./scheduling/workers.js";
import { auditEvents, serviceControls } from "./schema.js";
import { type AdminAction, adminActionSchema } from "./validation.js";

export const WORKER_AVAILABILITY_POLICY = {
  heartbeatMs: 30_000,
  pauseAfterMs: 180_000,
  resumeAfterMs: 120_000,
} as const;

export async function setWorkerGuard(db: CatalogDatabase, enabled: boolean, rawActor: AdminAction) {
  const actor = adminActionSchema.parse(rawActor);
  z.boolean().parse(enabled);
  return catalogTransaction(db, async (tx) => {
    await tx
      .update(serviceControls)
      .set({ workerGuardEnabled: enabled })
      .where(eq(serviceControls.singleton, true));
    await tx.execute(sql`DELETE FROM worker_availability`);
    await tx.insert(auditEvents).values({
      ...actor,
      action: enabled ? "worker_guard_enabled" : "worker_guard_disabled",
      details: {},
    });
    await refreshWorkerAvailability(tx, await databaseNow(tx));
  });
}

export async function refreshWorkerAvailability(tx: CatalogTransaction, now: Date) {
  const [controls] = await tx.select().from(serviceControls);
  if (!controls?.workerGuardEnabled) return;
  const matrices = (
    await tx.execute<{ id: string; heartbeat: Date | null }>(sql`
    SELECT m.id, (
      SELECT max(w.last_seen_at) FROM workers w
      WHERE w.state='healthy' AND w.accepting_jobs AND NOT w.recovery_required
        AND w.revoked_at IS NULL AND w.session_id IS NOT NULL
        AND w.last_seen_at > ${new Date(now.getTime() - WORKER_AVAILABILITY_POLICY.heartbeatMs)}
        AND w.capabilities->>'platform'=m.platform
        AND w.capabilities->>'harnessRevision'=m.harness_revision
        AND w.capabilities->>'planRevision'=m.plan_revision
        AND w.capabilities->>'policyRevision'=m.policy_revision
        AND w.capabilities->'preparationProfiles' ? m.preparation_profile
        AND NOT EXISTS (
          SELECT 1 FROM matrix_members mm JOIN runtime_images ri ON ri.id=mm.image_id
          WHERE mm.matrix_id=m.id AND NOT (w.capabilities->'imageDigests' ? ri.image_digest)
        )
    ) AS heartbeat FROM matrices m WHERE m.enabled
  `)
  ).rows;
  for (const matrix of matrices) {
    const previous = (
      await tx.execute<{
        paused: boolean;
        last_healthy_at: Date | null;
        healthy_since: Date | null;
        checked_at: Date;
      }>(sql`SELECT * FROM worker_availability WHERE matrix_id=${matrix.id}`)
    ).rows[0];
    const lastHealthy = matrix.heartbeat ?? previous?.last_healthy_at ?? null;
    const continuous =
      previous &&
      now.getTime() - previous.checked_at.getTime() <= WORKER_AVAILABILITY_POLICY.heartbeatMs;
    const healthySince = matrix.heartbeat
      ? continuous && previous.healthy_since
        ? previous.healthy_since
        : now
      : null;
    const missedOutage =
      previous?.last_healthy_at &&
      now.getTime() - previous.last_healthy_at.getTime() >= WORKER_AVAILABILITY_POLICY.pauseAfterMs;
    const paused =
      previous?.paused === false
        ? !!missedOutage ||
          !lastHealthy ||
          now.getTime() - lastHealthy.getTime() >= WORKER_AVAILABILITY_POLICY.pauseAfterMs
        : !healthySince ||
          now.getTime() - healthySince.getTime() < WORKER_AVAILABILITY_POLICY.resumeAfterMs;
    await tx.execute(sql`
      INSERT INTO worker_availability(matrix_id,paused,last_healthy_at,healthy_since,checked_at)
      VALUES(${matrix.id},${paused},${lastHealthy},${healthySince},${now})
      ON CONFLICT(matrix_id) DO UPDATE SET paused=EXCLUDED.paused,
        last_healthy_at=EXCLUDED.last_healthy_at,healthy_since=EXCLUDED.healthy_since,checked_at=EXCLUDED.checked_at
    `);
    if (!previous || previous.paused !== paused)
      await tx.insert(auditEvents).values({
        actor: "control:worker-guard",
        action: paused ? "worker_admission_paused" : "worker_admission_resumed",
        reason: paused
          ? "No compatible worker is available for admission."
          : "Compatible worker heartbeats were stable for two minutes.",
        details: { matrixId: matrix.id },
      });
  }
}

export async function workerAdmissionAvailable(tx: CatalogTransaction, matrixId: string) {
  const result = (
    await tx.execute<{ available: boolean }>(sql`
    SELECT NOT c.worker_guard_enabled OR EXISTS (
      SELECT 1 FROM worker_availability a WHERE a.matrix_id=${matrixId} AND NOT a.paused
        AND a.last_healthy_at > clock_timestamp() - interval '180 seconds'
    ) AS available FROM service_controls c WHERE c.singleton
  `)
  ).rows[0];
  return result?.available === true;
}
