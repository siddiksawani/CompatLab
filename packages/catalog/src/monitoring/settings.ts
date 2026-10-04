import { CLASSIFIER_REVISION } from "@compatlab/contracts";
import { assertPackageName, matchingVersions, type RegistryClient } from "@compatlab/engine";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { admitScanInTransaction } from "../admission.js";
import { allowedAssertion } from "../assertions/policy.js";
import { probeRevisions } from "../assertions/schema.js";
import type { Principal } from "../auth/github.js";
import { accountRequesterKey } from "../auth/security.js";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import { type PublicConfig, PublicRequestError, requesterIdentity } from "../public/security.js";
import { assertLinkedAuthority, assertRepository, type LinkedAuthority } from "./authority.js";
import { monitorReleases, monitors, notificationDeliveries, notifications } from "./schema.js";

const createSchema = z.strictObject({
  repositoryLinkId: z.uuid(),
  packageName: z.string().max(214),
  versionRange: z.string().min(1).max(256),
  rule: z.enum(["regressions_only", "any_evidence_change"]),
  emailEnabled: z.boolean(),
});
export async function monitoringOverview(
  db: CatalogDatabase,
  userId: string,
  emailAvailable: boolean,
) {
  const items = await db
    .select()
    .from(monitors)
    .where(eq(monitors.userId, userId))
    .orderBy(monitors.createdAt)
    .limit(5);
  const recent = await db
    .select({
      id: notifications.id,
      packageName: monitors.packageName,
      beforeReportId: notifications.beforeReportId,
      afterReportId: notifications.afterReportId,
      createdAt: notifications.createdAt,
      deliveryState: notificationDeliveries.state,
    })
    .from(notifications)
    .innerJoin(monitors, eq(monitors.id, notifications.monitorId))
    .leftJoin(notificationDeliveries, eq(notificationDeliveries.notificationId, notifications.id))
    .where(eq(monitors.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  const releases = await db
    .select({
      monitorId: monitorReleases.monitorId,
      version: monitorReleases.version,
      state: monitorReleases.state,
      error: monitorReleases.error,
      scanId: monitorReleases.scanId,
      reportId: monitorReleases.reportId,
    })
    .from(monitorReleases)
    .innerJoin(monitors, eq(monitors.id, monitorReleases.monitorId))
    .where(eq(monitors.userId, userId))
    .orderBy(desc(monitorReleases.createdAt), desc(monitorReleases.id))
    .limit(50);
  return {
    emailAvailable,
    releases,
    monitors: items.map(({ leaseToken: _token, leaseExpiresAt: _expires, ...item }) => item),
    notifications: recent,
  };
}
export async function monitoringMutation(
  db: CatalogDatabase,
  config: PublicConfig,
  user: Principal,
  request: Request,
  body: unknown,
  authorize: (linkId: string) => Promise<LinkedAuthority>,
  registry: RegistryClient,
  emailAvailable: boolean,
) {
  const path = new URL(request.url).pathname;
  if (path === "/api/maintainer/monitors") {
    const input = createSchema.parse(body);
    assertPackageName(input.packageName);
    if (input.emailEnabled && !emailAvailable)
      throw new PublicRequestError(409, "email_not_configured");
    const authority = await authorize(input.repositoryLinkId);
    const versions = matchingVersions(
      (await registry.versions(input.packageName)).versions,
      input.versionRange,
    );
    const latest = versions.at(-1);
    if (!latest) throw new PublicRequestError(400, "no_matching_versions");
    assertRepository(
      (await registry.resolve(input.packageName, latest)).manifest,
      authority.proof.fullName,
    );
    return catalogTransaction(db, async (tx) => {
      await assertLinkedAuthority(tx, authority);
      const [existing] = await tx
        .select()
        .from(monitors)
        .where(
          and(
            eq(monitors.userId, user.userId),
            eq(monitors.packageName, input.packageName),
            eq(monitors.versionRange, input.versionRange),
            eq(monitors.matrixId, config.matrixId),
          ),
        );
      if (existing) {
        if (existing.repositoryLinkId !== input.repositoryLinkId || existing.rule !== input.rule)
          throw new PublicRequestError(409, "monitor_identity_conflict");
        return { id: existing.id };
      }
      const [total] = await tx
        .select({ count: count() })
        .from(monitors)
        .where(eq(monitors.userId, user.userId));
      if ((total?.count ?? 0) >= 5) throw new PublicRequestError(429, "monitor_limit");
      const [monitor] = await tx
        .insert(monitors)
        .values({ ...input, userId: user.userId, matrixId: config.matrixId })
        .returning();
      if (!monitor) throw new Error("Monitor registration failed.");
      await tx.insert(monitorReleases).values(
        versions.map((version) => ({
          monitorId: monitor.id,
          version,
          state: version === latest ? ("pending" as const) : ("baseline" as const),
        })),
      );
      return { id: monitor.id };
    });
  }
  if (path === "/api/maintainer/monitors/update" || path === "/api/maintainer/monitors/delete") {
    const input = path.endsWith("/delete")
      ? z.strictObject({ id: z.uuid() }).parse(body)
      : z
          .strictObject({ id: z.uuid(), enabled: z.boolean(), emailEnabled: z.boolean() })
          .parse(body);
    const [monitor] = await db
      .select()
      .from(monitors)
      .where(and(eq(monitors.id, input.id), eq(monitors.userId, user.userId)));
    if (!monitor) throw new PublicRequestError(404, "not_found");
    if (path.endsWith("/delete")) {
      await db
        .delete(monitors)
        .where(and(eq(monitors.id, input.id), eq(monitors.userId, user.userId)));
      return { deleted: true };
    }
    const settings = z
      .strictObject({ id: z.uuid(), enabled: z.boolean(), emailEnabled: z.boolean() })
      .parse(body);
    if (settings.emailEnabled && !monitor.emailEnabled && !emailAvailable)
      throw new PublicRequestError(409, "email_not_configured");
    const increasing =
      (settings.enabled && !monitor.enabled) || (settings.emailEnabled && !monitor.emailEnabled);
    const authority = increasing ? await authorize(monitor.repositoryLinkId) : null;
    await catalogTransaction(db, async (tx) => {
      if (authority) await assertLinkedAuthority(tx, authority);
      const [fresh] = await tx.select().from(monitors).where(eq(monitors.id, monitor.id));
      if (!fresh) throw new PublicRequestError(404, "not_found");
      if (
        !authority &&
        ((settings.enabled && !fresh.enabled) || (settings.emailEnabled && !fresh.emailEnabled))
      )
        throw new PublicRequestError(409, "monitor_changed_retry");
      await tx
        .update(monitors)
        .set({
          enabled: settings.enabled,
          emailEnabled: settings.emailEnabled,
          leaseToken: null,
          leaseExpiresAt: null,
          nextPollAt: sql`clock_timestamp()`,
        })
        .where(eq(monitors.id, monitor.id));
      if (!settings.enabled || !settings.emailEnabled)
        await tx.execute(
          sql`UPDATE notification_deliveries d SET state='cancelled',lease_token=NULL,lease_expires_at=NULL FROM notifications n WHERE n.id=d.notification_id AND n.monitor_id=${monitor.id} AND d.state IN ('pending','sending') AND (d.lease_expires_at IS NULL OR d.lease_expires_at<=clock_timestamp())`,
        );
    });
    return { updated: true };
  }
  if (path === "/api/maintainer/rescan") {
    const input = z
      .strictObject({
        previousScanId: z.uuid(),
        repositoryLinkId: z.uuid(),
        assertionRevisionId: z.uuid().optional(),
      })
      .parse(body);
    if (!config.scansEnabled) throw new PublicRequestError(503, "scans_paused");
    const row = (
      await db.execute<{ name: string; version: string; matrixId: string }>(
        sql`SELECT p.name,v.version,s.matrix_id AS "matrixId" FROM scans s JOIN preparations prep ON prep.id=s.preparation_id JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id WHERE s.id=${input.previousScanId}`,
      )
    ).rows[0];
    if (!row) throw new PublicRequestError(404, "not_found");
    const authority = await authorize(input.repositoryLinkId),
      artifact = await registry.resolve(row.name, row.version);
    assertRepository(artifact.manifest, authority.proof.fullName);
    return catalogTransaction(db, async (tx) => {
      await assertLinkedAuthority(tx, authority);
      if (input.assertionRevisionId) {
        const [revision] = await tx
          .select()
          .from(probeRevisions)
          .where(
            and(
              eq(probeRevisions.id, input.assertionRevisionId),
              eq(probeRevisions.ownerUserId, user.userId),
              eq(probeRevisions.repositoryLinkId, input.repositoryLinkId),
            ),
          );
        if (
          !revision ||
          !(await allowedAssertion(tx, revision.id)) ||
          revision.bundle.manifest.packageName !== row.name ||
          !matchingVersions([row.version], revision.bundle.manifest.packageRange).length
        )
          throw new PublicRequestError(403, "probe_not_authorized");
      }
      const child = (
        await tx.execute<{ assertionId: string | null }>(
          sql`SELECT assertion_revision_id AS "assertionId" FROM scans WHERE previous_scan_id=${input.previousScanId}`,
        )
      ).rows[0];
      if (child && child.assertionId !== (input.assertionRevisionId ?? null))
        throw new PublicRequestError(409, "rescan_inputs_conflict");
      return admitScanInTransaction(tx, artifact, {
        matrixId: row.matrixId,
        ...requesterIdentity(request, config),
        accountKey: accountRequesterKey(config.requesterSecret, user.githubId),
        classifierRevision: CLASSIFIER_REVISION,
        rescan: {
          previousScanId: input.previousScanId,
          ...(input.assertionRevisionId ? { assertionRevisionId: input.assertionRevisionId } : {}),
        },
      });
    });
  }
  throw new PublicRequestError(404, "not_found");
}
