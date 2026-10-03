import { createHash, randomUUID } from "node:crypto";
import {
  PREPARATION_INSTALLER_IMAGE,
  PROBE_HARNESS_REVISION,
  PROBE_PLAN_REVISION,
  PROBE_POLICY_REVISION,
  type RuntimeImage,
} from "@compatlab/contracts";
import {
  type ResolvedArtifact,
  RUNTIME_BASE_IMAGE,
  RUNTIME_PROFILES,
  RUNTIME_SUPPORT_IMAGE,
} from "@compatlab/engine";
import { eq } from "drizzle-orm";
import {
  type AdmissionResult,
  admitScan,
  type CatalogDatabase,
  migrateCatalog,
  openCatalog,
  registerMatrix,
  registerRuntime,
  schema,
} from "../dist/index.js";

export const actor = { actor: "test-maintainer", reason: "Catalog qualification fixture." };
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const preparationProfile = "npm_11_19_0_linux_amd64_v2";
export function artifact(name = `fixture-${randomUUID()}`): ResolvedArtifact {
  return {
    name,
    version: "1.0.0",
    integrity: `sha512-${createHash("sha512").update(name).digest("base64")}`,
    tarballUrl: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-1.0.0.tgz`,
    observedTags: {},
    manifest: { name, version: "1.0.0" },
  };
}
export async function database() {
  const address = process.env.COMPATLAB_TEST_DATABASE_URL;
  if (!address)
    throw new Error("Set COMPATLAB_TEST_DATABASE_URL to a disposable PostgreSQL test server.");
  const url = new URL(address);
  if (!/^\/compatlab_test(?:_[a-z0-9_]+)?$/.test(url.pathname))
    throw new Error("The database qualification requires a compatlab_test database.");
  const admin = openCatalog(address);
  const name = `compatlab_test_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  url.pathname = name;
  const catalog = openCatalog(url.href);
  return {
    ...catalog,
    address: url.href,
    async dispose() {
      await catalog.close();
      await admin.pool.query(`DROP DATABASE "${name}"`);
      await admin.close();
    },
  };
}
export function image(index: number): RuntimeImage {
  const profile = RUNTIME_PROFILES[index];
  if (!profile) throw new TypeError("Unknown fixture runtime.");
  return {
    profileId: profile.id,
    kind: profile.kind,
    version: profile.version,
    imageId: `sha256:${hash(profile.id)}`,
    builtAt: "2026-10-03T00:00:00.000Z",
    sourceImage: profile.sourceImage,
    baseImage: RUNTIME_BASE_IMAGE,
    supportImage: RUNTIME_SUPPORT_IMAGE,
    platform: "linux_amd64_glibc",
    recipeRevision: "runtime_image_v1",
  };
}
export function matrix(imageIds: string[], revision = "initial_v1") {
  return {
    revision,
    preparationProfile,
    harnessRevision: PROBE_HARNESS_REVISION,
    planRevision: PROBE_PLAN_REVISION,
    policyRevision: PROBE_POLICY_REVISION,
    imageIds,
  };
}
export async function seedMatrix(db: CatalogDatabase) {
  const imageIds = await Promise.all(
    [0, 1, 2, 3].map((index) => registerRuntime(db, image(index), actor)),
  );
  return { imageIds, matrixId: await registerMatrix(db, matrix(imageIds), actor) };
}
export const options = (matrixId: string, requester: string = randomUUID()) => ({
  matrixId,
  requesterKey: hash(requester),
  classifierRevision: "classifier_v1",
});
export function admitted(value: AdmissionResult) {
  if (value.kind !== "admitted")
    throw new Error(`Expected admitted scan: ${JSON.stringify(value)}`);
  return value;
}
export async function readyPreparation(db: CatalogDatabase, preparationId: string) {
  const worker = (
    await db
      .insert(schema.workers)
      .values({
        tokenHash: hash(randomUUID()),
        capabilities: { platform: "linux_amd64_glibc" },
        capacity: 3,
        state: "healthy",
        recoveryRequired: false,
        sessionId: randomUUID(),
        lastSeenAt: new Date(),
      })
      .returning()
  )[0];
  if (!worker) throw new Error("Fixture worker creation failed.");
  const lock = Buffer.from('{"lockfileVersion":3}');
  await db
    .update(schema.preparations)
    .set({
      state: "ready",
      lockBytes: lock,
      lockDigest: hash(lock.toString()),
      treeDigest: hash("tree"),
      snapshotGeneration: randomUUID(),
      snapshotId: randomUUID(),
      installerImage: PREPARATION_INSTALLER_IMAGE,
      installedManifest: { name: "fixture", version: "1.0.0" },
      ownerWorkerId: worker.id,
      snapshotAvailable: true,
    })
    .where(eq(schema.preparations.id, preparationId));
}
export async function seedReport(db: CatalogDatabase, matrixId: string) {
  const source = artifact();
  const scan = admitted(await admitScan(db, source, options(matrixId)));
  await readyPreparation(db, scan.preparationId);
  await db
    .update(schema.scans)
    .set({ state: "completed", finishedAt: new Date() })
    .where(eq(schema.scans.id, scan.scanId));
  const report = (
    await db
      .insert(schema.reports)
      .values({
        scanId: scan.scanId,
        classifierRevision: "classifier_v1",
        payload: { schemaVersion: 1, evidence: "fixture" },
      })
      .returning()
  )[0];
  const preparation = (
    await db
      .select()
      .from(schema.preparations)
      .where(eq(schema.preparations.id, scan.preparationId))
  )[0];
  if (!report || !preparation) throw new Error("Fixture report creation failed.");
  return { source, scan, report, preparation };
}
export { migrateCatalog };

export async function concurrent<T>(operations: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(operations);
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

export async function seedOldScan(db: CatalogDatabase, matrixId: string) {
  const source = artifact();
  const pkg = (await db.insert(schema.packages).values({ name: source.name }).returning())[0];
  if (!pkg) throw new Error("Fixture package missing.");
  const version = (
    await db
      .insert(schema.packageVersions)
      .values({
        packageId: pkg.id,
        version: source.version,
        integrity: source.integrity,
        tarballUrl: source.tarballUrl,
        manifest: source.manifest,
      })
      .returning()
  )[0];
  if (!version) throw new Error("Fixture version missing.");
  const prep = (
    await db
      .insert(schema.preparations)
      .values({
        artifactId: version.id,
        profileRevision: preparationProfile,
        platform: "linux_amd64_glibc",
      })
      .returning()
  )[0];
  if (!prep) throw new Error("Fixture preparation missing.");
  const scan = (
    await db
      .insert(schema.scans)
      .values({
        preparationId: prep.id,
        matrixId,
        requesterKey: hash(randomUUID()),
        requesterExpiresAt: new Date(Date.now() + 86400_000),
        requestedAt: new Date(Date.now() - 360_000),
        admissionPolicy: "admission_v1",
        state: "cancelled",
      })
      .returning()
  )[0];
  if (!scan) throw new Error("Fixture scan missing.");
  await db
    .insert(schema.jobs)
    .values({ kind: "preparation", preparationId: prep.id, scanId: scan.id, state: "finished" });
  return { source, scan: { scanId: scan.id, preparationId: prep.id } };
}
