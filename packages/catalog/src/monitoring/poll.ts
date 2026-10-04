import { randomUUID } from "node:crypto";
import { CLASSIFIER_REVISION } from "@compatlab/contracts";
import { matchingVersions, RegistryClient } from "@compatlab/engine";
import { and, eq, sql } from "drizzle-orm";
import { admitScanInTransaction } from "../admission.js";
import { accountRequesterKey } from "../auth/security.js";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "../database.js";
import { type PublicConfig, PublicRequestError } from "../public/security.js";
import { assertLinkedAuthority, assertRepository, type LinkedAuthority } from "./authority.js";
import { monitorReleases, monitors } from "./schema.js";
export type AuthorizeMonitor = (userId: string, linkId: string) => Promise<LinkedAuthority>;
async function currentLease(tx: CatalogTransaction, id: string, token: string) {
  const result = await tx.execute(
    sql`SELECT id FROM monitors WHERE id=${id} AND enabled AND lease_token=${token} AND lease_expires_at>clock_timestamp()`,
  );
  if (!result.rows.length) throw new PublicRequestError(409, "monitor_changed_retry");
}
export async function pollMonitor(
  db: CatalogDatabase,
  config: PublicConfig,
  authorize: AuthorizeMonitor,
  registry = new RegistryClient(),
) {
  const token = randomUUID();
  const monitor = await catalogTransaction(db, async (tx) => {
    const claimed = (
      await tx.execute<{
        id: string;
      }>(sql`WITH candidate AS (SELECT id FROM monitors WHERE enabled AND next_poll_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_poll_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
  UPDATE monitors m SET lease_token=${token},lease_expires_at=clock_timestamp()+interval '5 minutes' FROM candidate c WHERE m.id=c.id RETURNING m.id`)
    ).rows[0];
    return claimed
      ? (await tx.select().from(monitors).where(eq(monitors.id, claimed.id)))[0]
      : undefined;
  });
  if (!monitor) return false;
  let error: string | null = null,
    backlog = false,
    revoked = false;
  try {
    const authority = await authorize(monitor.userId, monitor.repositoryLinkId);
    const versions = matchingVersions(
      (await registry.versions(monitor.packageName)).versions,
      monitor.versionRange,
    );
    await catalogTransaction(db, async (tx) => {
      await currentLease(tx, monitor.id, token);
      await assertLinkedAuthority(tx, authority);
      const known = await tx
        .select({ version: monitorReleases.version })
        .from(monitorReleases)
        .where(eq(monitorReleases.monitorId, monitor.id))
        .limit(5001);
      const seen = new Set(known.map((row) => row.version)),
        added = versions.filter((version) => !seen.has(version));
      if (known.length + added.length > 5000)
        throw new PublicRequestError(409, "release_history_limit");
      if (added.length)
        await tx
          .insert(monitorReleases)
          .values(
            added
              .slice(0, 25)
              .map((version) => ({ monitorId: monitor.id, version, state: "pending" as const })),
          )
          .onConflictDoNothing();
      backlog = added.length > 25;
    });
    const pending = await db
      .select()
      .from(monitorReleases)
      .where(and(eq(monitorReleases.monitorId, monitor.id), eq(monitorReleases.state, "pending")))
      .limit(5000);
    const ordered = matchingVersions(
      pending.map((row) => row.version),
      monitor.versionRange,
    );
    for (const version of ordered.slice(0, 5)) {
      if (!config.scansEnabled) {
        error = "scans_paused";
        break;
      }
      const release = pending.find((row) => row.version === version);
      if (!release) continue;
      const artifact = await registry.resolve(monitor.packageName, version);
      try {
        assertRepository(artifact.manifest, authority.proof.fullName);
      } catch {
        await catalogTransaction(db, async (tx) => {
          await currentLease(tx, monitor.id, token);
          await assertLinkedAuthority(tx, authority);
          await tx
            .update(monitorReleases)
            .set({ state: "blocked", error: "package_repository_mismatch" })
            .where(eq(monitorReleases.id, release.id));
        });
        continue;
      }
      const admission = await catalogTransaction(db, async (tx) => {
        await currentLease(tx, monitor.id, token);
        await assertLinkedAuthority(tx, authority);
        const key = accountRequesterKey(config.requesterSecret, authority.githubId);
        const result = await admitScanInTransaction(tx, artifact, {
          matrixId: monitor.matrixId,
          requesterKey: key,
          accountKey: key,
          classifierRevision: CLASSIFIER_REVISION,
        });
        if (result.kind === "admitted" || result.kind === "existing" || result.kind === "cached")
          await tx
            .update(monitorReleases)
            .set({
              state: "selected",
              scanId: result.scanId,
              reportId: result.kind === "cached" ? result.reportId : null,
              error: null,
            })
            .where(eq(monitorReleases.id, release.id));
        else if ("reason" in result)
          await tx
            .update(monitorReleases)
            .set({ state: result.kind === "blocked" ? "blocked" : "pending", error: result.reason })
            .where(eq(monitorReleases.id, release.id));
        return result;
      });
      if (admission.kind === "throttled") {
        backlog = true;
        error = admission.reason;
        break;
      }
    }
    backlog ||= pending.length > 5;
  } catch (cause) {
    revoked = cause instanceof PublicRequestError && cause.status === 403;
    error =
      cause instanceof PublicRequestError
        ? cause.code
        : cause instanceof TypeError
          ? "release_metadata_invalid"
          : "poll_unavailable";
  } finally {
    await db
      .update(monitors)
      .set({
        ...(revoked ? { enabled: false } : {}),
        leaseToken: null,
        leaseExpiresAt: null,
        lastCheckedAt: sql`clock_timestamp()`,
        lastError: error,
        nextPollAt: sql`clock_timestamp()+${backlog ? 60 : 900}*interval '1 second'`,
      })
      .where(and(eq(monitors.id, monitor.id), eq(monitors.leaseToken, token)));
  }
  return true;
}
