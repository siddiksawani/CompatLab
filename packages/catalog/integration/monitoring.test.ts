import { randomUUID } from "node:crypto";
import { COMPARISON_REVISION, PREPARATION_PROFILE_REVISION } from "@compatlab/contracts";
import { compareReports, RegistryClient } from "@compatlab/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { admitScan } from "../src/admission.js";
import { authorityRevision, type Principal, revokeAccount } from "../src/auth/github.js";
import { authAccounts, authSessions, authUsers, repositoryLinks } from "../src/auth/schema.js";
import {
  aggregatePendingReports,
  claimJob,
  readReport,
  readyWorker,
  registerWorker,
  scanProgress,
  submitJobResult,
} from "../src/index.js";
import { assertRepository, type LinkedAuthority } from "../src/monitoring/authority.js";
import { compareMonitorReports } from "../src/monitoring/compare.js";
import { deliverNotification } from "../src/monitoring/delivery.js";
import { pollMonitor } from "../src/monitoring/poll.js";
import {
  monitorReleases,
  monitors,
  notificationDeliveries,
  notifications,
} from "../src/monitoring/schema.js";
import { monitoringMutation, monitoringOverview } from "../src/monitoring/settings.js";
import { createReportApi } from "../src/reports/read.js";
import { prepared, runEvidence } from "./execution-fixtures.js";
import {
  actor,
  admitted,
  artifact,
  database,
  image,
  migrateCatalog,
  options,
  readyPreparation,
  seedMatrix,
  seedOldScan,
} from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>,
  matrixId: string,
  user: Principal,
  linkId: string;
const origin = "https://compatlab.example",
  email = { apiKey: "x".repeat(32), from: "reports@example.com" };
const config = () => ({
  origin,
  matrixId,
  requesterSecret: "a".repeat(64),
  proxySecret: "b".repeat(64),
  scansEnabled: true,
});
const registry = new RegistryClient();
let versions = ["1.0.0"],
  name = "monitor-fixture";
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => {
  await catalog?.dispose();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await catalog.pool.query(
    "TRUNCATE auth_users,notifications,monitor_releases,monitors,audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  matrixId = (await seedMatrix(catalog.db)).matrixId;
  versions = ["1.0.0"];
  name = "monitor-fixture";
  user = {
    userId: randomUUID(),
    accountId: randomUUID(),
    sessionId: randomUUID(),
    githubId: "72",
    name: "owner",
    email: "maintainer@example.com",
  };
  await catalog.db
    .insert(authUsers)
    .values({ id: user.userId, name: user.name, email: user.email, emailVerified: true });
  await catalog.db.insert(authAccounts).values({
    id: user.accountId,
    userId: user.userId,
    accountId: user.githubId,
    providerId: "github",
    accessToken: "encrypted-fixture",
  });
  await catalog.db.insert(authSessions).values({
    id: user.sessionId,
    userId: user.userId,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  linkId = randomUUID();
  await catalog.db.insert(repositoryLinks).values({
    id: linkId,
    userId: user.userId,
    repositoryId: "510",
    installationId: "91",
    fullName: "owner/package",
  });
  vi.spyOn(registry, "versions").mockImplementation(async () => ({
    versions: [...versions],
    tags: { latest: versions.at(-1) ?? "1.0.0" },
  }));
  vi.spyOn(registry, "resolve").mockImplementation(async (packageName, version = "1.0.0") => ({
    ...artifact(packageName),
    version,
    manifest: {
      name: packageName,
      version,
      repository: { url: "git+https://github.com/owner/package.git" },
    },
  }));
});
async function proof(): Promise<LinkedAuthority> {
  return {
    userId: user.userId,
    accountId: user.accountId,
    githubId: user.githubId,
    linkId,
    proof: {
      revision: await authorityRevision(catalog.db),
      repositoryId: "510",
      installationId: "91",
      fullName: "owner/package",
    },
  };
}
const authorize = async () => proof();
const request = (path: string) =>
  new Request(`${origin}/api/maintainer/${path}`, {
    headers: {
      "x-compatlab-proxy-token": config().proxySecret,
      "x-compatlab-client-ip": "198.51.100.1",
    },
  });
async function create(rule: "regressions_only" | "any_evidence_change" = "regressions_only") {
  const result = await monitoringMutation(
    catalog.db,
    config(),
    user,
    request("monitors"),
    { repositoryLinkId: linkId, packageName: name, versionRange: "*", rule, emailEnabled: true },
    authorize,
    registry,
    true,
  );
  if (!("id" in result)) throw new Error("Expected monitor.");
  return result.id;
}
async function due() {
  await catalog.pool.query("UPDATE monitors SET next_poll_at=now()-interval '1 second'");
}
async function execute(fail = false) {
  const worker = await registerWorker(
    catalog.db,
    {
      platform: "linux_amd64_glibc",
      preparationProfiles: [PREPARATION_PROFILE_REVISION],
      imageDigests: [0, 1, 2, 3].map((i) => image(i).imageId),
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
    },
    3,
    actor,
  );
  const sessionId = randomUUID();
  await readyWorker(catalog.db, worker.token, { sessionId, snapshotIds: [] });
  for (let i = 0; i < 64; i++) {
    const job = await claimJob(catalog.db, worker.token, { sessionId });
    if (!job) break;
    const result =
      job.kind === "preparation"
        ? prepared(job)
        : { kind: "run" as const, evidence: runEvidence(job) };
    if (result.kind === "run" && fail) {
      const observation = result.evidence.observations[0];
      if (observation) {
        result.evidence.observations[0] = {
          index: observation.index,
          outcome: "fail",
          resolvedTo: null,
          durationMs: 1,
          error: {
            name: "Error",
            code: "ERR_MODULE_NOT_FOUND",
            message: "Missing authored fixture.",
          },
        };
      }
    }
    await submitJobResult(catalog.db, worker.token, {
      sessionId,
      jobId: job.jobId,
      attemptToken: job.attemptToken,
      result,
    });
  }
  await aggregatePendingReports(catalog.db);
}
async function release(version: string, fail = false) {
  versions.push(version);
  await due();
  await pollMonitor(catalog.db, config(), authorize, registry);
  await execute(fail);
  await compareMonitorReports(catalog.db, origin, authorize, email.from);
}
async function notified() {
  await create();
  await pollMonitor(catalog.db, config(), authorize, registry);
  await execute();
  await compareMonitorReports(catalog.db, origin, authorize, email.from);
  await release("2.0.0", true);
  return (await catalog.db.select().from(notificationDeliveries))[0];
}
it("reconciles missed releases and backports once across competing schedulers", async () => {
  versions = ["1.0.0", "2.0.0"];
  const id = await create();
  expect(await catalog.db.select().from(monitorReleases)).toHaveLength(2);
  await Promise.all(
    Array.from({ length: 6 }, () => pollMonitor(catalog.db, config(), authorize, registry)),
  );
  await execute();
  await compareMonitorReports(catalog.db, origin, authorize, email.from);
  expect(await catalog.db.select().from(notifications)).toHaveLength(0);
  versions.push("1.5.0", "3.0.0");
  await due();
  await Promise.all(
    Array.from({ length: 6 }, () => pollMonitor(catalog.db, config(), authorize, registry)),
  );
  const selections = await catalog.db
    .select()
    .from(monitorReleases)
    .where(eq(monitorReleases.monitorId, id));
  expect(selections.map((r) => r.version).sort()).toEqual(["1.0.0", "1.5.0", "2.0.0", "3.0.0"]);
  expect(selections.filter((r) => r.state === "selected")).toHaveLength(3);
  expect(new Set(selections.map((r) => r.scanId).filter(Boolean)).size).toBe(3);
});
it("bounds monitors and rejects wrong repositories and revoked authority at commit", async () => {
  expect(() =>
    assertRepository({ repository: "https://github.com.evil/owner/package" }, "owner/package"),
  ).toThrow("package_repository_mismatch");
  expect(() =>
    assertRepository({ repository: "git@github.com:owner/package.git" }, "owner/package"),
  ).not.toThrow();
  for (let i = 0; i < 5; i++) {
    name = `fixture-${i}`;
    await create();
  }
  name = "fixture-six";
  await expect(create()).rejects.toThrow("monitor_limit");
  const old = await proof();
  await revokeAccount(catalog.db, user.userId);
  await due();
  await pollMonitor(catalog.db, config(), async () => old, registry);
  expect((await catalog.pool.query("SELECT id FROM scans")).rowCount).toBe(0);
  await expect(
    monitoringMutation(
      catalog.db,
      config(),
      user,
      request("monitors"),
      {
        repositoryLinkId: linkId,
        packageName: name,
        versionRange: "*",
        rule: "regressions_only",
        emailEnabled: false,
      },
      async () => old,
      registry,
      false,
    ),
  ).rejects.toThrow("authority_changed_retry");
});
it("preserves previous observations and deduplicates controlled rescans on the actual snapshot", async () => {
  const old = await seedOldScan(catalog.db, matrixId);
  await readyPreparation(catalog.db, old.scan.preparationId);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      admitScan(catalog.db, old.source, {
        ...options(matrixId),
        rescan: { previousScanId: old.scan.scanId },
      }),
    ),
  );
  expect(results.filter((r) => r.kind === "admitted")).toHaveLength(1);
  const admittedResult = results.find((r) => r.kind === "admitted");
  if (!admittedResult) throw new Error("Expected one rescan.");
  const created = admitted(admittedResult);
  expect(created.preparationId).toBe(old.scan.preparationId);
  const rows = (
    await catalog.pool.query(
      "SELECT id,observation_revision,previous_scan_id FROM scans ORDER BY observation_revision",
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ observation_revision: 1, previous_scan_id: old.scan.scanId });
  await expect(
    catalog.pool.query("UPDATE scans SET previous_scan_id=NULL WHERE id=$1", [created.scanId]),
  ).rejects.toThrow("immutable");
  const other = await seedOldScan(catalog.db, matrixId);
  await readyPreparation(catalog.db, other.scan.preparationId);
  await catalog.pool.query("UPDATE preparations SET snapshot_available=false WHERE id=$1", [
    other.scan.preparationId,
  ]);
  const rebuilt = admitted(
    await admitScan(catalog.db, other.source, {
      ...options(matrixId),
      rescan: { previousScanId: other.scan.scanId },
    }),
  );
  expect(rebuilt.preparationId).not.toBe(other.scan.preparationId);
});
it("suppresses unchanged noise and creates one immutable evidence-linked alert", async () => {
  await create();
  await pollMonitor(catalog.db, config(), authorize, registry);
  await execute();
  await compareMonitorReports(catalog.db, origin, authorize, email.from);
  await release("1.1.0");
  expect(await catalog.db.select().from(notifications)).toHaveLength(0);
  await release("2.0.0", true);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      compareMonitorReports(catalog.db, origin, authorize, email.from),
    ),
  );
  const alerts = await catalog.db.select().from(notifications);
  expect(alerts).toHaveLength(1);
  const alert = alerts[0];
  if (!alert) throw new Error("Expected alert.");
  expect(alert.ruleRevision).toBe(COMPARISON_REVISION);
  expect(alert.comparison.regression).toBe(true);
  expect(alert.comparison.inputs.map((i) => i.field)).toEqual(
    expect.arrayContaining(["artifact", "dependency_lock", "snapshot"]),
  );
  const deliveries = await catalog.db.select().from(notificationDeliveries);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.message).toContain(alert.beforeReportId);
  expect(deliveries[0]?.message).toContain(alert.afterReportId);
  const after = await readReport(catalog.db, alert.afterReportId);
  if (!after) throw new Error("Expected report.");
  const noisy = structuredClone(after.report);
  noisy.classifiedAt = new Date().toISOString();
  noisy.cells.forEach((c) => {
    c.durationMs += 1000;
    c.entries.forEach((e) => {
      e.durationMs = 999;
    });
  });
  expect(compareReports(after.report, noisy).changed).toBe(false);
});
it("retries delivery independently, preserving the provider idempotency key and body", async () => {
  const delivery = await notified();
  if (!delivery) throw new Error("Expected delivery.");
  const before = (await catalog.pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ id: randomUUID() }));
  await deliverNotification(catalog.db, email, authorize, fetcher);
  await catalog.pool.query(
    "UPDATE notification_deliveries SET next_attempt_at=now()-interval '1 second'",
  );
  await deliverNotification(catalog.db, email, authorize, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(fetcher.mock.calls[1]?.[1]?.headers);
  expect((await catalog.db.select().from(notificationDeliveries))[0]?.state).toBe("sent");
  expect((await catalog.pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(before);
});
it("recovers an expired delivery lease and refuses sends outside the provider deduplication window", async () => {
  const delivery = await notified();
  if (!delivery) throw new Error("Expected delivery.");
  await catalog.pool.query(
    "UPDATE notification_deliveries SET state='sending',first_attempt_at=now()-interval '1 minute',lease_token=$1,lease_expires_at=now()-interval '1 second',attempt=1",
    [randomUUID()],
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: randomUUID() }));
  await Promise.all(
    Array.from({ length: 5 }, () => deliverNotification(catalog.db, email, authorize, fetcher)),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await catalog.pool.query(
    "UPDATE notification_deliveries SET state='sending',attempt=16,lease_expires_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second'",
  );
  await deliverNotification(catalog.db, email, authorize, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await catalog.db.select().from(notificationDeliveries))[0]).toMatchObject({
    state: "uncertain",
    lastError: "attempts_exhausted",
  });
  await catalog.pool.query(
    "UPDATE notification_deliveries SET state='sending',first_attempt_at=now()-interval '24 hours',lease_expires_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second'",
  );
  await deliverNotification(catalog.db, email, authorize, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await catalog.db.select().from(notificationDeliveries))[0]?.state).toBe("uncertain");
});
it("cancels opted-out deliveries and deletes personal configuration without deleting reports", async () => {
  await notified();
  const [monitor] = await catalog.db.select().from(monitors);
  if (!monitor) throw new Error("Expected monitor.");
  await monitoringMutation(
    catalog.db,
    config(),
    user,
    request("monitors/update"),
    { id: monitor.id, enabled: true, emailEnabled: false },
    authorize,
    registry,
    true,
  );
  const fetcher = vi.fn<typeof fetch>();
  await deliverNotification(catalog.db, email, authorize, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await monitoringOverview(catalog.db, user.userId, true)).notifications[0]?.deliveryState,
  ).toBe("cancelled");
  const before = (await catalog.pool.query("SELECT count(*)::int AS n FROM reports")).rows[0].n;
  await catalog.db.delete(authUsers).where(eq(authUsers.id, user.userId));
  expect(await catalog.db.select().from(monitors)).toHaveLength(0);
  expect(await catalog.db.select().from(notificationDeliveries)).toHaveLength(0);
  expect((await catalog.pool.query("SELECT count(*)::int AS n FROM reports")).rows[0].n).toBe(
    before,
  );
});
it("serves bounded history, evidence badges and comparisons without selecting scans", async () => {
  await notified();
  const alerts = await catalog.db.select().from(notifications);
  const alert = alerts[0];
  if (!alert) throw new Error("Expected alert.");
  const api = createReportApi(catalog.db),
    before = (await catalog.pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n;
  const comparison = await api(
    new Request(
      `${origin}/api/v1/comparisons?before=${alert.beforeReportId}&after=${alert.afterReportId}`,
    ),
  );
  expect(comparison.status).toBe(200);
  const history = await api(new Request(`${origin}/api/v1/history?name=${name}`));
  expect(((await history.json()) as { reports: unknown[] }).reports).toHaveLength(2);
  const badge = await api(new Request(`${origin}/api/v1/badges/${alert.afterReportId}.svg`));
  expect(badge.headers.get("content-type")).toContain("image/svg");
  expect(await badge.text()).toContain("loading evidence");
  expect((await catalog.pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(before);
  const scan = (await catalog.db.select().from(monitorReleases)).find(
    (r) => r.reportId === alert.afterReportId,
  );
  expect((await scanProgress(catalog.db, scan?.scanId ?? ""))?.state).toBe("completed");
});
it("defers an out-of-order comparison without keeping it at the front of the queue", async () => {
  const monitorId = await create();
  await pollMonitor(catalog.db, config(), authorize, registry);
  await execute();
  await compareMonitorReports(catalog.db, origin, authorize, email.from);
  versions.push("3.0.0");
  await due();
  await pollMonitor(catalog.db, config(), authorize, registry);
  await execute(true);
  await catalog.db
    .insert(monitorReleases)
    .values({ monitorId, version: "2.0.0", state: "pending" });
  expect(await compareMonitorReports(catalog.db, origin, authorize, email.from)).toBe(0);
  const higher = (await catalog.db.select().from(monitorReleases)).find(
    (r) => r.version === "3.0.0",
  );
  expect(higher?.nextCompareAt.getTime()).toBeGreaterThan(Date.now());
  expect(higher?.comparedAt).toBeNull();
  await catalog.pool.query(
    "UPDATE monitor_releases SET state='blocked',error='fixture_unavailable' WHERE version='2.0.0'",
  );
  await catalog.pool.query("UPDATE monitor_releases SET next_compare_at=now()-interval '1 second'");
  expect(await compareMonitorReports(catalog.db, origin, authorize, email.from)).toBe(1);
  expect(await catalog.db.select().from(notifications)).toHaveLength(1);
});
it("bounds discovery batches and fences a stale polling lease before scan admission", async () => {
  await create();
  versions = Array.from({ length: 32 }, (_, i) => `1.0.${i}`);
  let changed = false;
  vi.spyOn(registry, "resolve").mockImplementation(async (packageName, version = "1.0.0") => {
    if (!changed) {
      changed = true;
      await catalog.pool.query("UPDATE monitors SET lease_token=NULL,lease_expires_at=NULL");
    }
    return {
      ...artifact(packageName),
      version,
      manifest: { name: packageName, version, repository: "github:owner/package" },
    };
  });
  await pollMonitor(catalog.db, config(), authorize, registry);
  expect(await catalog.db.select().from(monitorReleases)).toHaveLength(26);
  expect((await catalog.pool.query("SELECT id FROM scans")).rowCount).toBe(0);
});

it("allows pausing when email delivery has been disabled by the operator", async () => {
  const id = await create();
  await catalog.db.update(monitors).set({ emailEnabled: true }).where(eq(monitors.id, id));
  const denied = vi.fn(async () => {
    throw new Error("GitHub unavailable");
  });
  await monitoringMutation(
    catalog.db,
    config(),
    user,
    request("monitors/update"),
    { id, enabled: false, emailEnabled: true },
    denied,
    registry,
    false,
  );
  expect(denied).not.toHaveBeenCalled();
  expect((await catalog.db.select().from(monitors))[0]?.enabled).toBe(false);
});
