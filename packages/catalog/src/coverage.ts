import { createHash } from "node:crypto";
import { CLASSIFIER_REVISION } from "@compatlab/contracts";
import {
  assertPackageName,
  isExactVersion,
  RegistryClient,
  RegistryError,
} from "@compatlab/engine";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { admitScanInTransaction } from "./admission.js";
import { workerAdmissionAvailable } from "./availability.js";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "./database.js";
import { auditEvents } from "./schema.js";
import { type AdminAction, adminActionSchema, uuidSchema } from "./validation.js";

const requesterKey = createHash("sha256").update("compatlab:curated-coverage:v1").digest("hex");
const targetSchema = z.strictObject({
  name: z.string().max(214),
  version: z.string().max(256),
});
type Target = { id: string; name: string; version: string; matrixId: string };

export async function addCoverageTargets(
  db: CatalogDatabase,
  rawMatrixId: string,
  input: unknown,
  rawActor: AdminAction,
) {
  const matrixId = uuidSchema.parse(rawMatrixId);
  const actor = adminActionSchema.parse(rawActor);
  const targets = z.array(targetSchema).min(1).max(50).parse(input);
  for (const target of targets) {
    assertPackageName(target.name);
    if (!isExactVersion(target.version)) throw new TypeError("Coverage requires exact versions.");
  }
  return catalogTransaction(db, async (tx) => {
    const matrix = await tx.execute(sql`SELECT id FROM matrices WHERE id=${matrixId} AND enabled`);
    if (!matrix.rows.length) throw new TypeError("Coverage requires an enabled matrix.");
    const added = await tx.execute(sql`
      INSERT INTO coverage_targets(package_name,version,matrix_id)
      SELECT name,version,${matrixId} FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS t(name text,version text)
      ON CONFLICT(package_name,version,matrix_id) DO NOTHING RETURNING id`);
    const count = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM coverage_targets WHERE state IN ('pending','submitted')`,
    );
    if ((count.rows[0]?.count ?? 0) > 200)
      throw new TypeError("Coverage queue is limited to 200 pending or submitted targets.");
    await tx.insert(auditEvents).values({
      ...actor,
      action: "coverage_targets_added",
      details: { matrixId, added: added.rowCount ?? 0 },
    });
    return { added: added.rowCount ?? 0 };
  });
}

export async function skipCoverageTarget(
  db: CatalogDatabase,
  rawId: string,
  rawActor: AdminAction,
) {
  const id = uuidSchema.parse(rawId),
    actor = adminActionSchema.parse(rawActor);
  return catalogTransaction(db, async (tx) => {
    const changed =
      await tx.execute(sql`UPDATE coverage_targets SET state='blocked',last_reason='operator_skipped'
      WHERE id=${id} AND state='pending' RETURNING id`);
    if (!changed.rows.length) throw new TypeError("Only pending coverage targets can be skipped.");
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: "coverage_target_skipped", details: { targetId: id } });
  });
}

export async function setCoveragePaused(
  db: CatalogDatabase,
  paused: boolean,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor);
  z.boolean().parse(paused);
  return catalogTransaction(db, async (tx) => {
    await tx.execute(sql`UPDATE service_controls SET coverage_paused=${paused} WHERE singleton`);
    await tx
      .insert(auditEvents)
      .values({ ...actor, action: paused ? "coverage_paused" : "coverage_resumed", details: {} });
  });
}

async function idle(tx: CatalogTransaction) {
  const result = await tx.execute<{ available: boolean }>(sql`
    SELECT NOT coverage_paused AND NOT admission_paused AND deployment_release IS NULL
      AND NOT EXISTS(SELECT 1 FROM scans WHERE state IN ('requested','preparing','running','aggregating'))
      AND NOT EXISTS(SELECT 1 FROM jobs WHERE state IN ('leased','running') OR cleanup_required)
      AS available FROM service_controls WHERE singleton`);
  return result.rows[0]?.available === true;
}

export async function advanceCoverage(db: CatalogDatabase, registry = new RegistryClient()) {
  const target = await catalogTransaction(db, async (tx) => {
    await tx.execute(sql`
      UPDATE coverage_targets t SET state=CASE WHEN s.state IN ('completed','inconclusive') THEN 'completed' ELSE 'failed' END,
        last_reason=s.state FROM scans s WHERE t.scan_id=s.id AND t.state='submitted'
        AND s.state IN ('completed','inconclusive','failed_infrastructure','rejected','cancelled')`);
    if (!(await idle(tx))) return null;
    const selected = (
      await tx.execute<Target>(sql`
      SELECT t.id,t.package_name AS name,t.version,t.matrix_id AS "matrixId" FROM coverage_targets t
      CROSS JOIN service_controls c
      WHERE t.state='pending' AND t.next_attempt_at<=clock_timestamp() AND c.singleton
        AND (NOT c.worker_guard_enabled OR EXISTS(SELECT 1 FROM worker_availability a
          WHERE a.matrix_id=t.matrix_id AND NOT a.paused AND a.last_healthy_at>clock_timestamp()-interval '180 seconds'))
      ORDER BY t.created_at,t.id LIMIT 1`)
    ).rows[0];
    if (!selected) return null;
    if (!(await workerAdmissionAvailable(tx, selected.matrixId))) return null;
    await tx.execute(
      sql`UPDATE coverage_targets SET next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE id=${selected.id}`,
    );
    return selected;
  });
  if (!target) return;
  let artifact: Awaited<ReturnType<RegistryClient["resolve"]>>;
  try {
    artifact = await registry.resolve(target.name, target.version, AbortSignal.timeout(5000));
  } catch (error) {
    const permanent =
      error instanceof RegistryError &&
      ["package_not_found", "package_version_not_found", "package_manifest_invalid"].includes(
        error.classification,
      );
    await catalogTransaction(db, async (tx) => {
      await tx.execute(sql`UPDATE coverage_targets SET attempts=least(attempts+1,3),
        state=CASE WHEN ${permanent} OR attempts>=2 THEN 'failed' ELSE 'pending' END,
        last_reason='registry_metadata_unavailable',next_attempt_at=clock_timestamp()+interval '5 minutes'
        WHERE id=${target.id} AND state='pending'`);
    });
    return;
  }
  await catalogTransaction(db, async (tx) => {
    if (!(await idle(tx))) return;
    const pending = await tx.execute(
      sql`SELECT id FROM coverage_targets WHERE id=${target.id} AND state='pending'`,
    );
    if (!pending.rows.length) return;
    const result = await admitScanInTransaction(tx, artifact, {
      matrixId: target.matrixId,
      requesterKey,
      classifierRevision: CLASSIFIER_REVISION,
      source: "coverage",
    });
    if (result.kind === "admitted" || result.kind === "existing" || result.kind === "cached") {
      await tx.execute(
        sql`UPDATE coverage_targets SET state='submitted',scan_id=${result.scanId},last_reason=${result.kind} WHERE id=${target.id}`,
      );
    } else if (result.kind === "blocked") {
      await tx.execute(
        sql`UPDATE coverage_targets SET state='blocked',last_reason=${result.reason} WHERE id=${target.id}`,
      );
    } else if (result.kind === "throttled") {
      await tx.execute(sql`UPDATE coverage_targets SET last_reason=${result.reason},
        next_attempt_at=clock_timestamp()+${Math.max(60, result.retryAfterSeconds)}*interval '1 second' WHERE id=${target.id}`);
    }
  });
}

export async function coverageStatus(db: CatalogDatabase) {
  const [controls, totals, targets] = await Promise.all([
    db.execute(sql`SELECT coverage_paused AS paused FROM service_controls WHERE singleton`),
    db.execute(
      sql`SELECT state,count(*)::int AS count FROM coverage_targets GROUP BY state ORDER BY state`,
    ),
    db.execute(sql`SELECT t.id,t.package_name AS name,t.version,t.matrix_id AS "matrixId",t.state,t.last_reason AS reason,t.attempts,
      t.scan_id AS "scanId",s.state AS "scanState",t.next_attempt_at AS "nextAttemptAt"
      FROM coverage_targets t LEFT JOIN scans s ON s.id=t.scan_id ORDER BY t.created_at DESC,t.id LIMIT 200`),
  ]);
  return { schemaVersion: 1, ...controls.rows[0], totals: totals.rows, targets: targets.rows };
}
