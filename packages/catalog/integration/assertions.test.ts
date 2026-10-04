import { randomUUID } from "node:crypto";
import {
  CLASSIFIER_REVISION,
  type JobResult,
  PREPARATION_PROFILE_REVISION,
} from "@compatlab/contracts";
import { assertionDefinition, compareReports, RegistryClient } from "@compatlab/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { assertionBundle, assertionEvidence } from "../../../tests/assertion-fixtures.js";
import {
  assertionOverview,
  registerAssertion,
  revokeAssertion,
} from "../src/assertions/registry.js";
import { probeRevisions } from "../src/assertions/schema.js";
import { authorityRevision, type Principal } from "../src/auth/github.js";
import { authAccounts, authSessions, authUsers, repositoryLinks } from "../src/auth/schema.js";
import {
  aggregatePendingReports,
  claimJob,
  findCachedReport,
  readReport,
  readyWorker,
  reconcileCatalog,
  registerWorker,
  renewJob,
  reproductionReport,
  retryInfrastructure,
  scanProgress,
  submitJobResult,
} from "../src/index.js";
import type { LinkedAuthority } from "../src/monitoring/authority.js";
import { monitoringMutation } from "../src/monitoring/settings.js";
import * as schema from "../src/schema.js";
import { prepared, runEvidence } from "./execution-fixtures.js";
import { actor, database, image, migrateCatalog, seedMatrix, seedOldScan } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>,
  matrixId: string,
  user: Principal,
  linkId: string,
  parent: Awaited<ReturnType<typeof seedOldScan>>;
const registry = new RegistryClient(),
  origin = "https://compatlab.example";
const config = () => ({
  origin,
  matrixId,
  requesterSecret: "a".repeat(64),
  proxySecret: "b".repeat(64),
  scansEnabled: true,
});
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
    "TRUNCATE auth_users,probe_revisions,audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  matrixId = (await seedMatrix(catalog.db)).matrixId;
  parent = await seedOldScan(catalog.db, matrixId);
  user = {
    userId: randomUUID(),
    accountId: randomUUID(),
    sessionId: randomUUID(),
    githubId: "72",
    name: "owner",
    email: "owner@example.com",
  };
  linkId = randomUUID();
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
  await catalog.db.insert(repositoryLinks).values({
    id: linkId,
    userId: user.userId,
    repositoryId: "51",
    installationId: "9",
    fullName: "owner/package",
  });
  vi.spyOn(registry, "versions").mockResolvedValue({
    versions: ["1.0.0"],
    tags: { latest: "1.0.0" },
  });
  vi.spyOn(registry, "resolve").mockResolvedValue({
    ...parent.source,
    manifest: { ...parent.source.manifest, repository: "github:owner/package" },
  });
});
async function authority(): Promise<LinkedAuthority> {
  return {
    userId: user.userId,
    accountId: user.accountId,
    githubId: user.githubId,
    sessionId: user.sessionId,
    linkId,
    proof: {
      revision: await authorityRevision(catalog.db),
      repositoryId: "51",
      installationId: "9",
      fullName: "owner/package",
    },
  };
}
const bundle = () => assertionBundle(parent.source.name);
async function revision() {
  const result = await registerAssertion(catalog.db, await authority(), bundle(), registry);
  if (!result) throw new Error("Expected revision.");
  return result;
}
async function rescan(id: string) {
  return monitoringMutation(
    catalog.db,
    config(),
    user,
    new Request(`${origin}/api/maintainer/rescan`, {
      headers: {
        "x-compatlab-proxy-token": config().proxySecret,
        "x-compatlab-client-ip": "198.51.100.1",
      },
    }),
    { previousScanId: parent.scan.scanId, repositoryLinkId: linkId, assertionRevisionId: id },
    () => authority(),
    registry,
    false,
  );
}
async function worker(assertions = true) {
  const w = await registerWorker(
    catalog.db,
    {
      platform: "linux_amd64_glibc",
      preparationProfiles: [PREPARATION_PROFILE_REVISION],
      imageDigests: [0, 1, 2, 3].map((i) => image(i).imageId),
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
      ...(assertions ? { assertionRevision: "assertion_v1" as const } : {}),
    },
    3,
    actor,
  );
  const sessionId = randomUUID();
  await readyWorker(catalog.db, w.token, { sessionId, snapshotIds: [] });
  return { ...w, sessionId };
}
async function execution(fail = false) {
  const registered = await revision(),
    admission = await rescan(registered.id);
  if (!("preparationId" in admission)) throw new Error("Expected scan.");
  const w = await worker();
  let assertions = 0;
  for (let n = 0; n < 30; n++) {
    const job = await claimJob(catalog.db, w.token, { sessionId: w.sessionId });
    if (!job) break;
    const result: JobResult =
      job.kind === "preparation"
        ? prepared(job)
        : job.kind === "run"
          ? { kind: "run", evidence: runEvidence(job) }
          : {
              kind: "assertion",
              evidence: assertionEvidence(job.bundle, job.image.profileId, fail),
            };
    if (job.kind === "assertion") assertions++;
    await submitJobResult(catalog.db, w.token, {
      jobId: job.jobId,
      sessionId: w.sessionId,
      attemptToken: job.attemptToken,
      result,
    });
  }
  expect(assertions).toBe(4);
  expect(await aggregatePendingReports(catalog.db)).toEqual({ completed: 1, failed: 0 });
  const progress = await scanProgress(catalog.db, admission.scanId);
  const report = await readReport(catalog.db, progress?.reportId ?? "");
  if (!report) throw new Error("Expected report.");
  return { registered, admission, report };
}
it("registers immutable bounded revisions and rejects stale or mismatched authority", async () => {
  const a = await revision();
  expect(await revision()).toEqual(a);
  await expect(
    registerAssertion(
      catalog.db,
      await authority(),
      { ...bundle(), repository: "other/package" },
      registry,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const stale = await authority();
  await catalog.pool.query("UPDATE auth_authority_state SET revision=revision+1 WHERE singleton");
  await expect(registerAssertion(catalog.db, stale, bundle(), registry)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    catalog.db
      .update(probeRevisions)
      .set({ digest: "c".repeat(64) })
      .where(eq(probeRevisions.id, a.id)),
  ).rejects.toThrow();
  expect((await assertionOverview(catalog.db, user.userId)).assertions).toHaveLength(1);
});
it("blocks workers lacking the assertion capability before snapshot ownership", async () => {
  const r = await revision();
  await rescan(r.id);
  const old = await worker(false);
  expect(await claimJob(catalog.db, old.token, { sessionId: old.sessionId })).toBeNull();
  const current = await worker();
  expect((await claimJob(catalog.db, current.token, { sessionId: current.sessionId }))?.kind).toBe(
    "preparation",
  );
});
it("counts revoked revisions toward retention limits and prevents operator retries from dropping assertions", async () => {
  const first = await revision();
  const scan = await rescan(first.id);
  if (!("scanId" in scan)) throw new Error("Expected scan.");
  await expect(retryInfrastructure(catalog.db, scan.scanId, actor)).rejects.toThrow(
    "maintainer-authorized",
  );
  await revokeAssertion(catalog.db, user.userId, first.id);
  for (let index = 1; index < 10; index++) {
    const input = bundle();
    input.commit = index.toString(16).padStart(40, "0");
    await registerAssertion(catalog.db, await authority(), input, registry);
  }
  await expect(
    registerAssertion(
      catalog.db,
      await authority(),
      { ...bundle(), commit: "f".repeat(40) },
      registry,
    ),
  ).rejects.toMatchObject({ status: 429, code: "probe_revision_limit" });
});
it("keeps named failed assertions separate from passing automatic loads and exports replay inputs", async () => {
  const { report, admission } = await execution(true);
  expect(report.report.outcome).toBe("pass");
  expect(report.report.evidenceLevel).toBe("smoke_tested");
  expect(report.report.cells).toHaveLength(16);
  expect(
    report.report.assertions?.[0]?.cells.every(
      (c) => c.outcome === "fail" && c.evidenceLevel === "probe_verified",
    ),
  ).toBe(true);
  expect((await reproductionReport(catalog.db, report.report.id))?.assertion).toEqual(bundle());
  const prep = (
    await catalog.db
      .select()
      .from(schema.preparations)
      .where(eq(schema.preparations.id, admission.preparationId))
  )[0];
  expect(
    await findCachedReport(catalog.db, {
      artifactId: prep?.artifactId ?? "",
      matrixId,
      classifierRevision: CLASSIFIER_REVISION,
    }),
  ).toBeNull();
  const pass = structuredClone(report.report);
  for (const c of pass.assertions?.[0]?.cells ?? []) {
    c.outcome = "pass";
    c.failure = null;
  }
  expect(compareReports(pass, report.report).regression).toBe(true);
  const changed = structuredClone(report.report);
  const named = changed.assertions?.[0];
  if (named) named.definition.digest = "c".repeat(64);
  expect(compareReports(pass, changed)).toMatchObject({
    regression: false,
    inputs: expect.arrayContaining([expect.objectContaining({ field: "maintainer_assertions" })]),
  });
});
it("fences changed rescan inputs and revocation during an active lease", async () => {
  const r = await revision();
  const first = await rescan(r.id);
  expect(await rescan(r.id)).toEqual({ ...first, kind: "existing" });
  const other = await registerAssertion(
    catalog.db,
    await authority(),
    { ...bundle(), manifest: { ...bundle().manifest, name: "different-assertion" } },
    registry,
  );
  await expect(rescan(other?.id ?? "")).rejects.toMatchObject({ status: 409 });
  const w = await worker(),
    job = await claimJob(catalog.db, w.token, { sessionId: w.sessionId });
  if (!job) throw new Error("Expected job.");
  await revokeAssertion(catalog.db, user.userId, r.id);
  await expect(
    renewJob(catalog.db, w.token, {
      jobId: job.jobId,
      sessionId: w.sessionId,
      attemptToken: job.attemptToken,
    }),
  ).rejects.toMatchObject({ code: "stale_attempt" });
  await expect(
    submitJobResult(catalog.db, w.token, {
      jobId: job.jobId,
      sessionId: w.sessionId,
      attemptToken: job.attemptToken,
      result: prepared(job),
    }),
  ).rejects.toMatchObject({ code: "stale_attempt" });
  await reconcileCatalog(catalog.db);
});
it("revokes linked revisions and removes ownership on account deletion while preserving public evidence", async () => {
  const { registered, report } = await execution();
  await catalog.db
    .update(repositoryLinks)
    .set({ revokedAt: new Date() })
    .where(eq(repositoryLinks.id, linkId));
  expect((await readReport(catalog.db, report.report.id))?.status.current).toBe(false);
  await catalog.db.delete(authUsers).where(eq(authUsers.id, user.userId));
  const [retained] = await catalog.db
    .select()
    .from(probeRevisions)
    .where(eq(probeRevisions.id, registered.id));
  expect(retained).toMatchObject({
    ownerUserId: null,
    repositoryLinkId: null,
    digest: assertionDefinition(bundle()).digest,
  });
  expect(retained?.revokedAt).not.toBeNull();
  expect((await readReport(catalog.db, report.report.id))?.report.assertions).toHaveLength(1);
});
it("rejects forged assertion identities and mismatched scan/run foreign keys", async () => {
  const r = await revision();
  await rescan(r.id);
  const w = await worker();
  for (let i = 0; i < 25; i++) {
    const job = await claimJob(catalog.db, w.token, { sessionId: w.sessionId });
    if (!job) throw new Error("Expected job.");
    if (job.kind === "assertion") {
      const evidence = assertionEvidence(job.bundle, job.image.profileId);
      evidence.revisionDigest = "c".repeat(64);
      await expect(
        submitJobResult(catalog.db, w.token, {
          jobId: job.jobId,
          sessionId: w.sessionId,
          attemptToken: job.attemptToken,
          result: { kind: "assertion", evidence },
        }),
      ).rejects.toMatchObject({ code: "invalid_result" });
      await expect(
        catalog.db.insert(schema.runs).values({
          scanId: parent.scan.scanId,
          matrixId,
          imageId: (await catalog.db.select().from(schema.runtimeImages))[0]?.id ?? "",
          probeGroup: "root",
          mode: "esm",
          assertionRevisionId: r.id,
        }),
      ).rejects.toThrow();
      return;
    }
    await submitJobResult(catalog.db, w.token, {
      jobId: job.jobId,
      sessionId: w.sessionId,
      attemptToken: job.attemptToken,
      result:
        job.kind === "preparation" ? prepared(job) : { kind: "run", evidence: runEvidence(job) },
    });
  }
  throw new Error("Expected assertion assignment.");
});
