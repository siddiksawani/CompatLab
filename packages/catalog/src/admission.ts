import type { ScanState } from "@compatlab/contracts";
import type { ResolvedArtifact } from "@compatlab/engine";
import { and, count, desc, eq, exists, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
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
import { revisionSchema, uuidSchema, validateArtifact } from "./validation.js";

export const ADMISSION_POLICY = {
  revision: "admission_v1",
  queuedScans: 20,
  activePerRequester: 2,
  cooldownSeconds: 300,
} as const;
const active: ScanState[] = ["requested", "preparing", "running", "aggregating"];
const optionsSchema = z.strictObject({
  matrixId: uuidSchema,
  requesterKey: z.string().regex(/^[a-f0-9]{64}$/),
  classifierRevision: revisionSchema,
});
export type AdmissionOptions = z.infer<typeof optionsSchema>;
export type AdmissionResult =
  | { kind: "cached"; reportId: string; scanId: string }
  | { kind: "existing" | "admitted"; scanId: string; preparationId: string }
  | { kind: "blocked"; reason: "policy_or_matrix" | "artifact_integrity_changed" }
  | {
      kind: "throttled";
      reason: "queue_full" | "requester_limit" | "package_cooldown";
      retryAfterSeconds: number;
    };

export async function admitScan(
  db: CatalogDatabase,
  rawArtifact: ResolvedArtifact,
  rawOptions: AdmissionOptions,
): Promise<AdmissionResult> {
  const artifact = validateArtifact(rawArtifact),
    options = optionsSchema.parse(rawOptions);
  return catalogTransaction(db, async (tx) => {
    const observed = await observeArtifact(tx, artifact);
    if (observed.integrityAnomaly) return { kind: "blocked", reason: "artifact_integrity_changed" };
    const selected = await allowedSelection(tx, observed.id, options.matrixId);
    if (!selected) return { kind: "blocked", reason: "policy_or_matrix" };
    const cached = await findCachedReport(tx, {
      artifactId: observed.id,
      matrixId: options.matrixId,
      classifierRevision: options.classifierRevision,
    });
    if (cached) return { kind: "cached", ...cached };
    const [existing] = await tx
      .select({ scanId: scans.id, preparationId: preparations.id })
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
    if (existing) return { kind: "existing", ...existing };
    const millis = (
      await tx.execute<{ millis: string }>(
        sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS millis`,
      )
    ).rows[0]?.millis;
    const now = new Date(Number(millis));
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
      .where(and(eq(scans.requesterKey, options.requesterKey), inArray(scans.state, active)));
    if ((requester?.count ?? 0) >= ADMISSION_POLICY.activePerRequester)
      return { kind: "throttled", reason: "requester_limit", retryAfterSeconds: 30 };
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
    if (recent) {
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
          isNull(scans.id),
          or(
            and(
              inArray(preparations.state, ["pending", "preparing"]),
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
              isNotNull(preparations.snapshotId),
              isNotNull(preparations.installedManifest),
              eq(workers.state, "healthy"),
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
    const [scan] = await tx
      .insert(scans)
      .values({
        preparationId: preparation.id,
        matrixId: options.matrixId,
        requesterKey: options.requesterKey,
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
    return { kind: "admitted", scanId: scan.id, preparationId: preparation.id };
  });
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
