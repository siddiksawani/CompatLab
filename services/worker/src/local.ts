import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type LocalReport,
  localReportSchema,
  MAX_REPORT_BYTES,
  PROBE_HARNESS_REVISION,
  PROBE_LIMITS,
  PROBE_POLICY_REVISION,
  parseBoundedJson,
  type RuntimeImage,
  runtimeMatrixSchema,
} from "@compatlab/contracts";
import {
  artifactIntegrity,
  assertPackageName,
  executePlan,
  isExactVersion,
  MAX_LOCK_BYTES,
  manifestObservations,
  planProbes,
  RegistryClient,
  type ResolvedArtifact,
  registryTarballUrl,
  runtimeProfile,
  validateLock,
} from "@compatlab/engine";
import { docker } from "./command.js";
import { readBoundedFile } from "./preparation/files.js";
import {
  assertPreparationHost,
  INSTALLER_IMAGE,
  PREPARATION_PROFILE,
  type PreparedSnapshot,
  prepareArtifact,
} from "./preparation/prepare.js";
import { PROXY_IMAGE } from "./preparation/proxy.js";
import { reuseSnapshot } from "./preparation/reuse.js";
import { createProbeBackend } from "./runtime/backend.js";
import { buildRuntimeImages, verifyRuntimeImages } from "./runtime/images.js";

export type LocalOptions = { stateDirectory: string; signal?: AbortSignal };

export function parsePackageSpec(spec: string): { name: string; version: string } {
  const separator = spec.lastIndexOf("@");
  const name = spec.slice(0, separator),
    version = spec.slice(separator + 1);
  assertPackageName(name);
  if (separator < 1 || !isExactVersion(version))
    throw new TypeError("Use package@exact-version, including a scope when needed.");
  return { name, version };
}

export async function checkPackage(spec: string, options: LocalOptions): Promise<LocalReport> {
  const { name, version } = parsePackageSpec(spec);
  const state = await localState(options.stateDirectory);
  const images = await localImages(state);
  const artifact = await new RegistryClient().resolve(name, version, options.signal);
  await installerImages();
  const signal = deadline(options.signal);
  const snapshot = await prepareArtifact(artifact, join(state, "snapshots"), signal);
  return scanSnapshot(snapshot, images, state, signal, {
    method: "prepared",
    previousGeneration: null,
  });
}

export async function reproduceReport(
  file: string,
  options: LocalOptions & { rebuild: boolean },
): Promise<LocalReport> {
  const report = localReportSchema.parse(
    parseBoundedJson(await readBoundedFile(resolve(file), MAX_REPORT_BYTES), MAX_REPORT_BYTES),
  );
  const state = await localState(options.stateDirectory);
  const artifact: ResolvedArtifact = { ...report.artifact, manifest: {}, observedTags: {} };
  assertPackageName(artifact.name);
  if (!isExactVersion(artifact.version))
    throw new TypeError("The report artifact version is invalid.");
  artifactIntegrity(artifact.integrity);
  registryTarballUrl(artifact.tarballUrl);
  if (
    report.snapshot.profileRevision !== PREPARATION_PROFILE ||
    report.snapshot.installerImage !== INSTALLER_IMAGE
  )
    throw new TypeError("The report preparation profile is unavailable.");
  await verifyRuntimeImages(report.images);
  const signal = deadline(options.signal);
  let snapshot: PreparedSnapshot;
  if (options.rebuild) {
    const lockBytes = await readBoundedFile(
      join(state, "locks", `${report.snapshot.lockDigest}.json`),
      MAX_LOCK_BYTES,
    );
    if (validateLock(lockBytes, artifact).digest !== report.snapshot.lockDigest)
      throw new TypeError("The retained lock changed.");
    await installerImages();
    snapshot = await prepareArtifact(artifact, join(state, "snapshots"), signal, lockBytes);
  } else {
    snapshot = await reuseSnapshot(report.snapshot.id, join(state, "snapshots"), artifact, signal);
    if (
      snapshot.generation !== report.snapshot.generation ||
      snapshot.lock.digest !== report.snapshot.lockDigest ||
      snapshot.tree.digest !== report.snapshot.treeDigest
    )
      throw new TypeError("The report snapshot identity changed.");
  }
  return scanSnapshot(snapshot, report.images, state, signal, {
    method: options.rebuild ? "rebuilt_from_lock" : "verified_reuse",
    previousGeneration: report.snapshot.generation,
  });
}

async function scanSnapshot(
  snapshot: PreparedSnapshot,
  images: RuntimeImage[],
  state: string,
  signal: AbortSignal,
  reproduction: LocalReport["reproduction"],
): Promise<LocalReport> {
  const manifest = await readBoundedFile(
    join(snapshot.workspace, "node_modules", snapshot.artifact.name, "package.json"),
    2 * 1024 ** 2,
  );
  const plan = planProbes(
    manifest,
    images.map((image) => runtimeProfile(image.profileId)),
  );
  const backend = await createProbeBackend(snapshot.workspace, join(state, "jobs"), images);
  await mkdir(join(state, "locks"), { recursive: true, mode: 0o700 });
  await storeImmutable(
    join(state, "locks", `${snapshot.lock.digest}.json`),
    await readBoundedFile(join(snapshot.workspace, "package-lock.json"), MAX_LOCK_BYTES),
  );
  const { name, version, integrity, tarballUrl } = snapshot.artifact;
  const report: LocalReport = {
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    evidenceLevel: "static_only",
    harnessRevision: PROBE_HARNESS_REVISION,
    policyRevision: PROBE_POLICY_REVISION,
    artifact: { name, version, integrity, tarballUrl },
    snapshot: {
      id: snapshot.id,
      generation: snapshot.generation,
      lockDigest: snapshot.lock.digest,
      treeDigest: snapshot.tree.digest,
      profileRevision: snapshot.profileRevision,
      installerImage: snapshot.installerImage,
    },
    reproduction,
    images,
    plan,
    staticObservations: manifestObservations(
      manifest,
      snapshot.tree.entries.map((entry) => entry.path),
    ),
    groups: [],
    deadlineReached: false,
  };
  const evidenceBytes = MAX_REPORT_BYTES - Buffer.byteLength(JSON.stringify(report)) - 64;
  report.groups = await executePlan(plan, images, backend, signal, evidenceBytes);
  report.evidenceLevel = report.groups.some((group) => group.sessions.length > 0)
    ? "smoke_tested"
    : "static_only";
  report.deadlineReached = signal.aborted;
  const bytes = Buffer.from(JSON.stringify(report));
  if (bytes.length > MAX_REPORT_BYTES) throw new TypeError("The local report exceeds 20 MiB.");
  localReportSchema.parse(report);
  await mkdir(join(state, "reports"), { recursive: true, mode: 0o700 });
  await storeImmutable(join(state, "reports", `${report.id}.json`), bytes);
  return report;
}

async function localState(path: string): Promise<string> {
  await assertPreparationHost();
  const state = resolve(path);
  await mkdir(state, { recursive: true, mode: 0o700 });
  const info = await lstat(state);
  if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o077) !== 0)
    throw new TypeError("Local state must be a private root-owned directory.");
  return state;
}
async function localImages(state: string): Promise<RuntimeImage[]> {
  const path = join(state, "runtime-images.json");
  let images: RuntimeImage[];
  try {
    images = runtimeMatrixSchema.parse(
      JSON.parse((await readBoundedFile(path, 64 * 1024)).toString("utf8")),
    );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    images = await buildRuntimeImages();
    await storeImmutable(path, Buffer.from(JSON.stringify(images)));
  }
  await verifyRuntimeImages(images);
  return images;
}
async function installerImages(): Promise<void> {
  for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
    await docker(["pull", "--platform=linux/amd64", image], 180_000);
}
function deadline(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(PROBE_LIMITS.scanMs), ...(signal ? [signal] : [])]);
}
async function storeImmutable(path: string, bytes: Buffer): Promise<void> {
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (
      !hasCode(error, "EEXIST") ||
      !(await readBoundedFile(path, Math.max(bytes.length, 1))).equals(bytes)
    )
      throw error;
  }
}
function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
