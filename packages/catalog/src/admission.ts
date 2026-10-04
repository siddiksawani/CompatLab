import type { ScanState } from "@compatlab/contracts";
import type { ResolvedArtifact } from "@compatlab/engine";
import { and, count, desc, eq, exists, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { allowedAssertion } from "./assertions/policy.js";
import { workerAdmissionAvailable } from "./availability.js";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "./database.js";
import { allowedSelection, findCachedReport } from "./policy.js";
import {
  auditEvents,
  jobs,
  packages,
  packageVersions,
  preparations,
  scans,
  workers,
} from "./schema.js";
import { adminActionSchema, revisionSchema, uuidSchema, validateArtifact } from "./validation.js";

export const ADMISSION_POLICY = {
  revision: "admission_v5",
  queuedScans: 20,
  activePerRequester: 2,
  hourlyPerRequester: 10,
  cooldownSeconds: 300,
} as const;
const active: ScanState[] = ["requested", "preparing", "running", "aggregating"];
const optionsSchema = z.strictObject({
  matrixId: uuidSchema,
  requesterKey: z.string().regex(/^[a-f0-9]{64}$/),
  accountKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  requesterAliases: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .max(7)
    .default([]),
  classifierRevision: revisionSchema,
  retry: adminActionSchema.extend({ scanId: uuidSchema }).optional(),
  rescan: z
    .strictObject({ previousScanId: uuidSchema, assertionRevisionId: uuidSchema.optional() })
    .optional(),
});
export type AdmissionOptions = z.input<typeof optionsSchema>;
export type AdmissionResult =
  | { kind: "cached"; reportId: string; scanId: string }
  | { kind: "existing" | "admitted"; scanId: string; preparationId: string }
  | { kind: "blocked"; reason: "policy_or_matrix" | "artifact_integrity_changed" }
  | {
      kind: "throttled";
      reason:
        | "queue_full"
        | "requester_limit"
        | "requester_rate"
        | "package_cooldown"
        | "admission_paused"
        | "worker_unavailable"
        | "artifact_active";
      retryAfterSeconds: number;
    };

export async function admitScan(
  db: CatalogDatabase,
  rawArtifact: ResolvedArtifact,
  rawOptions: AdmissionOptions,
): Promise<AdmissionResult> {
  return catalogTransaction(db, (tx) => admitScanInTransaction(tx, rawArtifact, rawOptions));
}

export async function admitScanInTransaction(
  tx: CatalogTransaction,
  rawArtifact: ResolvedArtifact,
  rawOptions: AdmissionOptions,
): Promise<AdmissionResult> {
  const artifact = validateArtifact(rawArtifact),
    options = optionsSchema.parse(rawOptions);
  if (options.retry && options.rescan) throw new TypeError("Choose retry or rescan.");
  const observed = await observeArtifact(tx, artifact);
  if (observed.integrityAnomaly) return { kind: "blocked", reason: "artifact_integrity_changed" };
  const selected = await allowedSelection(tx, observed.id, options.matrixId);
  if (!(await allowedAssertion(tx, options.rescan?.assertionRevisionId ?? null)))
    return { kind: "blocked", reason: "policy_or_matrix" };
  if (!selected) return { kind: "blocked", reason: "policy_or_matrix" };
  if (options.retry) {
    const previous = (
      await tx.execute<{ id: string }>(sql`
        SELECT s.id FROM scans s JOIN preparations p ON p.id=s.preparation_id
        WHERE s.id=${options.retry.scanId} AND s.state='failed_infrastructure'
        AND s.matrix_id=${options.matrixId} AND p.artifact_id=${observed.id}
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.scan_id=s.id AND (j.state IN ('leased','running') OR j.cleanup_required))
      `)
    ).rows[0];
    if (!previous)
      throw new TypeError(
        "Retry requires a matching infrastructure failure and confirmed cleanup.",
      );
  }
  if (options.rescan) {
    const parent = (
      await tx.execute<{ id: string }>(
        sql`SELECT s.id FROM scans s JOIN preparations p ON p.id=s.preparation_id WHERE s.id=${options.rescan.previousScanId} AND s.matrix_id=${options.matrixId} AND p.artifact_id=${observed.id} AND s.state IN ('completed','inconclusive','failed_infrastructure','rejected','cancelled') AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.scan_id=s.id AND (j.state IN ('leased','running') OR j.cleanup_required))`,
      )
    ).rows[0];
    if (!parent)
      throw new TypeError("Rescan requires a matching terminal observation and confirmed cleanup.");
    const [child] = await tx
      .select({
        scanId: scans.id,
        preparationId: scans.preparationId,
        assertionId: scans.assertionRevisionId,
      })
      .from(scans)
      .where(eq(scans.previousScanId, parent.id));
    if (child) {
      if (child.assertionId !== (options.rescan.assertionRevisionId ?? null))
        throw new TypeError("Rescan inputs conflict.");
      return { kind: "existing", scanId: child.scanId, preparationId: child.preparationId };
    }
  }
  const cached = options.rescan
    ? null
    : await findCachedReport(tx, {
        artifactId: observed.id,
        matrixId: options.matrixId,
        classifierRevision: options.classifierRevision,
      });
  if (cached) return { kind: "cached", ...cached };
  const [existing] = await tx
    .select({
      scanId: scans.id,
      preparationId: preparations.id,
      assertionId: scans.assertionRevisionId,
    })
    .from(scans)
    .innerJoin(preparations, eq(scans.preparationId, preparations.id))
    .where(
      and(
        eq(preparations.artifactId, observed.id),
        eq(scans.matrixId, options.matrixId),
        inArray(scans.state, active),
      ),
    )
    .orderBy(desc(scans.requestedAt))
    .limit(1);
  if (existing)
    return options.rescan || existing.assertionId
      ? { kind: "throttled", reason: "artifact_active", retryAfterSeconds: 30 }
      : { kind: "existing", scanId: existing.scanId, preparationId: existing.preparationId };
  if (
    (
      await tx.execute<{ paused: boolean }>(
        sql`SELECT admission_paused OR deployment_release IS NOT NULL AS paused FROM service_controls WHERE singleton`,
      )
    ).rows[0]?.paused !== false
  )
    return { kind: "throttled", reason: "admission_paused", retryAfterSeconds: 60 };
  if (!(await workerAdmissionAvailable(tx, options.matrixId)))
    return { kind: "throttled", reason: "worker_unavailable", retryAfterSeconds: 60 };
  const millis = (
    await tx.execute<{ millis: string }>(
      sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS millis`,
    )
  ).rows[0]?.millis;
  const now = new Date(Number(millis));
  const requesterKeys = [...new Set([options.requesterKey, ...options.requesterAliases])];
  if (!Number.isFinite(now.getTime())) throw new Error("Database time is unavailable.");
  const [queue] = await tx
    .select({ count: count() })
    .from(scans)
    .where(eq(scans.state, "requested"));
  if ((queue?.count ?? 0) >= ADMISSION_POLICY.queuedScans)
    return { kind: "throttled", reason: "queue_full", retryAfterSeconds: 15 };
  const [requester] = await tx
    .select({ count: count() })
    .from(scans)
    .where(
      and(
        or(
          inArray(scans.requesterKey, requesterKeys),
          options.accountKey ? eq(scans.accountKey, options.accountKey) : undefined,
        ),
        inArray(scans.state, active),
      ),
    );
  if ((requester?.count ?? 0) >= ADMISSION_POLICY.activePerRequester)
    return { kind: "throttled", reason: "requester_limit", retryAfterSeconds: 30 };
  const recentRequests = (
    await tx.execute<{ count: number; oldest: string }>(
      sql`SELECT count(*)::int AS count, floor(extract(epoch FROM min(requested_at))*1000)::bigint AS oldest FROM scans WHERE (requester_key IN (${sql.join(
        requesterKeys.map((key) => sql`${key}`),
        sql`,`,
      )}) OR account_key=${options.accountKey ?? null}) AND requested_at > ${new Date(now.getTime() - 3_600_000)}`,
    )
  ).rows[0];
  if ((recentRequests?.count ?? 0) >= ADMISSION_POLICY.hourlyPerRequester)
    return {
      kind: "throttled",
      reason: "requester_rate",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((Number(recentRequests?.oldest) + 3_600_000 - now.getTime()) / 1000),
      ),
    };
  const [recent] = await tx
    .select({ requestedAt: scans.requestedAt })
    .from(scans)
    .innerJoin(preparations, eq(preparations.id, scans.preparationId))
    .innerJoin(packageVersions, eq(packageVersions.id, preparations.artifactId))
    .where(
      and(
        eq(packageVersions.packageId, observed.packageId),
        eq(packageVersions.version, artifact.version),
      ),
    )
    .orderBy(desc(scans.requestedAt))
    .limit(1);
  if (recent && !options.retry) {
    const seconds = Math.ceil(
      (recent.requestedAt.getTime() + ADMISSION_POLICY.cooldownSeconds * 1000 - now.getTime()) /
        1000,
    );
    if (seconds > 0)
      return { kind: "throttled", reason: "package_cooldown", retryAfterSeconds: seconds };
  }
  const [reusable] = await tx
    .select({ id: preparations.id })
    .from(preparations)
    .leftJoin(workers, eq(workers.id, preparations.ownerWorkerId))
    .leftJoin(
      scans,
      and(eq(scans.preparationId, preparations.id), eq(scans.matrixId, options.matrixId)),
    )
    .where(
      and(
        eq(preparations.artifactId, observed.id),
        eq(preparations.profileRevision, selected.profile),
        eq(preparations.platform, selected.platform),
        options.rescan ? undefined : isNull(scans.id),
        or(
          and(
            inArray(preparations.state, ["pending", "preparing"]),
            options.rescan?.assertionRevisionId ? sql`false` : undefined,
            exists(
              tx
                .select({ id: jobs.id })
                .from(jobs)
                .where(
                  and(
                    eq(jobs.preparationId, preparations.id),
                    eq(jobs.kind, "preparation"),
                    inArray(jobs.state, ["queued", "leased", "running"]),
                  ),
                ),
            ),
          ),
          and(
            eq(preparations.state, "ready"),
            eq(preparations.snapshotAvailable, true),
            options.rescan?.assertionRevisionId
              ? sql`EXISTS(SELECT 1 FROM workers aw WHERE aw.id=${preparations.ownerWorkerId} AND aw.capabilities->>'assertionRevision'='assertion_v1')`
              : sql`true`,
            isNotNull(preparations.snapshotId),
            isNotNull(preparations.installedManifest),
            eq(workers.state, "healthy"),
            eq(workers.acceptingJobs, true),
            eq(workers.recoveryRequired, false),
            isNotNull(workers.sessionId),
            isNull(workers.revokedAt),
            sql`${workers.lastSeenAt} > ${new Date(now.getTime() - 30_000)}`,
          ),
        ),
      ),
    )
    .orderBy(desc(preparations.createdAt))
    .limit(1);
  const preparation =
    reusable ??
    (
      await tx
        .insert(preparations)
        .values({
          artifactId: observed.id,
          profileRevision: selected.profile,
          platform: selected.platform,
        })
        .returning({ id: preparations.id })
    )[0];
  if (!preparation) throw new Error("Preparation reservation failed.");
  const observationRevision =
    (
      await tx.execute<{ revision: number }>(
        sql`SELECT coalesce(max(s.observation_revision)+1,0)::int AS revision FROM scans s JOIN preparations p ON p.id=s.preparation_id WHERE p.artifact_id=${observed.id} AND s.matrix_id=${options.matrixId}`,
      )
    ).rows[0]?.revision ?? 0;
  const [scan] = await tx
    .insert(scans)
    .values({
      preparationId: preparation.id,
      matrixId: options.matrixId,
      observationRevision,
      previousScanId: options.rescan?.previousScanId ?? null,
      assertionRevisionId: options.rescan?.assertionRevisionId ?? null,
      requesterKey: options.requesterKey,
      accountKey: options.accountKey ?? null,
      requesterExpiresAt: new Date(now.getTime() + 7 * 86400_000),
      requestedAt: now,
      admissionPolicy: ADMISSION_POLICY.revision,
    })
    .returning({ id: scans.id });
  if (!scan) throw new Error("Scan reservation failed.");
  if (!reusable)
    await tx
      .insert(jobs)
      .values({ kind: "preparation", preparationId: preparation.id, scanId: scan.id });
  if (options.retry) {
    const { scanId: previousScanId, ...actor } = options.retry;
    await tx.insert(auditEvents).values({
      ...actor,
      action: "infrastructure_retry_requested",
      details: { previousScanId, scanId: scan.id },
    });
  }
  return { kind: "admitted", scanId: scan.id, preparationId: preparation.id };
}

async function observeArtifact(
  tx: CatalogTransaction,
  artifact: ReturnType<typeof validateArtifact>,
) {
  await tx.insert(packages).values({ name: artifact.name }).onConflictDoNothing();
  const [pkg] = await tx
    .select({ id: packages.id })
    .from(packages)
    .where(eq(packages.name, artifact.name));
  if (!pkg) throw new Error("Package registration failed.");
  const versions = await tx
    .select({
      id: packageVersions.id,
      packageId: packageVersions.packageId,
      integrity: packageVersions.integrity,
      integrityAnomaly: packageVersions.integrityAnomaly,
    })
    .from(packageVersions)
    .where(
      and(eq(packageVersions.packageId, pkg.id), eq(packageVersions.version, artifact.version)),
    );
  const changed = versions.some((row) => row.integrity !== artifact.integrity);
  let observed = versions.find((row) => row.integrity === artifact.integrity);
  const hasTags = Object.keys(artifact.observedTags).length > 0;
  if (!observed) {
    const { name: _name, ...identity } = artifact;
    [observed] = await tx
      .insert(packageVersions)
      .values({
        ...identity,
        packageId: pkg.id,
        integrityAnomaly: changed,
        tagsObservedAt: hasTags ? sql`clock_timestamp()` : null,
      })
      .returning();
  } else if (hasTags) {
    await tx
      .update(packageVersions)
      .set({ observedTags: artifact.observedTags, tagsObservedAt: sql`clock_timestamp()` })
      .where(eq(packageVersions.id, observed.id));
  }
  if (!observed) throw new Error("Artifact registration failed.");
  if (changed && versions.some((row) => !row.integrityAnomaly)) {
    await tx
      .update(packageVersions)
      .set({ integrityAnomaly: true })
      .where(
        and(eq(packageVersions.packageId, pkg.id), eq(packageVersions.version, artifact.version)),
      );
    await tx.insert(auditEvents).values({
      actor: "registry",
      action: "artifact_integrity_changed",
      reason: "Registry integrity differs for an observed package version.",
      details: { packageId: pkg.id, version: artifact.version },
    });
  }
  return { ...observed, integrityAnomaly: observed.integrityAnomaly || changed };
}
