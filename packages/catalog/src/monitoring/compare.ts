import { COMPARISON_REVISION } from "@compatlab/contracts";
import { compareReports, earlierVersion, matchingVersions } from "@compatlab/engine";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { authUsers } from "../auth/schema.js";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import { PublicRequestError } from "../public/security.js";
import { readReport, reportHeader } from "../reports/read.js";
import { reports } from "../schema.js";
import { assertLinkedAuthority } from "./authority.js";
import type { AuthorizeMonitor } from "./poll.js";
import { monitorReleases, monitors, notificationDeliveries, notifications } from "./schema.js";
export async function compareMonitorReports(
  db: CatalogDatabase,
  origin: string,
  authorize: AuthorizeMonitor,
  emailFrom?: string,
) {
  await db.execute(
    sql`UPDATE monitor_releases SET compared_at=clock_timestamp(),error='aggregation_unavailable' WHERE id IN (SELECT mr.id FROM monitor_releases mr JOIN scans s ON s.id=mr.scan_id WHERE mr.compared_at IS NULL AND s.aggregation_failed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.scan_id=s.id) LIMIT 100)`,
  );
  const pending = await db
    .select({ release: monitorReleases, monitor: monitors })
    .from(monitorReleases)
    .innerJoin(monitors, eq(monitors.id, monitorReleases.monitorId))
    .where(
      and(
        eq(monitors.enabled, true),
        eq(monitorReleases.state, "selected"),
        isNull(monitorReleases.comparedAt),
        sql`${monitorReleases.nextCompareAt}<=clock_timestamp()`,
        sql`EXISTS(SELECT 1 FROM reports r WHERE r.scan_id=${monitorReleases.scanId})`,
      ),
    )
    .orderBy(monitorReleases.nextCompareAt, monitorReleases.createdAt)
    .limit(25);
  let processed = 0;
  for (const { release, monitor } of pending) {
    if (processed >= 5) break;
    const [row] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.scanId, release.scanId ?? ""), isNull(reports.replacedBy)))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    if (!row) continue;
    const after = await readReport(db, row.id);
    if (!after) continue;
    const releases = await db
      .select()
      .from(monitorReleases)
      .where(eq(monitorReleases.monitorId, monitor.id))
      .limit(5000);
    const lower = releases.filter((r) => earlierVersion(r.version, release.version));
    if (lower.some((r) => r.state === "pending" || (r.state === "selected" && !r.comparedAt))) {
      await db
        .update(monitorReleases)
        .set({ nextCompareAt: sql`clock_timestamp()+interval '1 minute'` })
        .where(eq(monitorReleases.id, release.id));
      continue;
    }
    const candidates = (
      await db.execute<{ id: string; version: string }>(
        sql`SELECT DISTINCT ON(v.version) r.id,v.version FROM reports r JOIN scans s ON s.id=r.scan_id JOIN preparations prep ON prep.id=s.preparation_id JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id WHERE p.name=${monitor.packageName} AND s.matrix_id=${monitor.matrixId} AND ${
          lower.length
            ? sql`v.version IN (${sql.join(
                lower.map((r) => sql`${r.version}`),
                sql`,`,
              )})`
            : sql`false`
        } AND r.replaced_by IS NULL AND r.invalidated_at IS NULL AND s.state IN ('completed','inconclusive') ORDER BY v.version,r.created_at DESC,r.id DESC LIMIT 5000`,
      )
    ).rows;
    const versions = matchingVersions(
      candidates.map((r) => r.version),
      monitor.versionRange,
    ).filter((v) => earlierVersion(v, release.version));
    const previous = candidates.find((r) => r.version === versions.at(-1));
    const before = previous ? await readReport(db, previous.id) : null;
    const comparison = before ? compareReports(before.report, after.report) : null;
    const meaningful =
      releases.some((r) => r.comparedAt !== null) &&
      !!comparison &&
      before?.status.current &&
      after.status.current &&
      comparison.comparable &&
      (monitor.rule === "regressions_only" ? comparison.regression : comparison.changed);
    const authority = await authorize(monitor.userId, monitor.repositoryLinkId).catch(
      async (error) => {
        if (error instanceof PublicRequestError && error.status === 403)
          await db
            .update(monitors)
            .set({ enabled: false, lastError: "repository_authority_required" })
            .where(eq(monitors.id, monitor.id));
        return null;
      },
    );
    if (!authority) {
      await db
        .update(monitorReleases)
        .set({ nextCompareAt: sql`clock_timestamp()+interval '15 minutes'` })
        .where(eq(monitorReleases.id, release.id));
      continue;
    }
    await catalogTransaction(db, async (tx) => {
      await assertLinkedAuthority(tx, authority);
      const [current] = await tx
        .select()
        .from(monitors)
        .where(and(eq(monitors.id, monitor.id), eq(monitors.enabled, true)));
      const [fresh] = await tx
        .select()
        .from(monitorReleases)
        .where(and(eq(monitorReleases.id, release.id), isNull(monitorReleases.comparedAt)));
      if (!current || !fresh) return;
      // Recheck validity under the same lock used by report invalidation.
      const valid =
        meaningful &&
        comparison &&
        (await reportHeader(tx, comparison.beforeReportId))?.current &&
        (await reportHeader(tx, comparison.afterReportId))?.current;
      if (valid && comparison) {
        const [notification] = await tx
          .insert(notifications)
          .values({
            monitorId: monitor.id,
            beforeReportId: comparison.beforeReportId,
            afterReportId: comparison.afterReportId,
            ruleRevision: COMPARISON_REVISION,
            comparison,
          })
          .onConflictDoNothing()
          .returning();
        const [user] = await tx
          .select()
          .from(authUsers)
          .where(and(eq(authUsers.id, monitor.userId), eq(authUsers.emailVerified, true)));
        if (notification && current.emailEnabled && emailFrom && user)
          await tx.insert(notificationDeliveries).values({
            notificationId: notification.id,
            message: JSON.stringify({
              from: emailFrom,
              to: [user.email],
              subject: `CompatLab: evidence changed for ${monitor.packageName}`,
              text: `Loading evidence changed from ${comparison.beforeVersion} to ${comparison.afterVersion}.\n\nBefore: ${origin}/reports/${comparison.beforeReportId}\nAfter: ${origin}/reports/${comparison.afterReportId}\nCompare: ${origin}/compare?before=${comparison.beforeReportId}&after=${comparison.afterReportId}\n\nChanged inputs: ${comparison.inputs.map((i) => i.field).join(", ") || "none recorded"}. Changed inputs do not establish package causality.\nManage alerts: ${origin}/account`,
            }),
          });
      }
      await tx
        .update(monitorReleases)
        .set({ reportId: row.id, comparedAt: sql`clock_timestamp()` })
        .where(eq(monitorReleases.id, release.id));
    });
    processed++;
  }
  return processed;
}
