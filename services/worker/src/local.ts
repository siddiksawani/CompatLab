import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type AssertionBundle,
  type AssertionEvidence,
  type CiArtifact,
  type CiReport,
  ciArtifactSchema,
  ciProvenanceSchema,
  ciReportSchema,
  type LocalReport,
  localReportSchema,
  MAX_REPORT_BYTES,
  MAX_SCAN_LOG_BYTES,
  PROBE_HARNESS_REVISION,
  PROBE_LIMITS,
  PROBE_POLICY_REVISION,
  parseBoundedJson,
  parseReproductionInputs,
  type RuntimeImage,
  runtimeMatrixSchema,
} from "@compatlab/contracts";
import {
  artifactIntegrity,
  assertPackageName,
  type ExecutionArtifact,
  executePlan,
  executionSummary,
  isExactVersion,
  MAX_LOCK_BYTES,
  manifestObservations,
  matchingVersions,
  planProbes,
  RegistryClient,
  type ResolvedArtifact,
  registryTarballUrl,
  runtimeProfile,
  validateAssertionBundle,
  validateLock,
} from "@compatlab/engine";
import { docker } from "./command.js";
import { ExecutionSupervisor } from "./lifecycle/supervisor.js";
import { readBoundedFile } from "./preparation/files.js";
import {
  assertPreparationHost,
  INSTALLER_IMAGE,
  PREPARATION_PROFILE,
  type PreparedSnapshot,
} from "./preparation/prepare.js";
import { PROXY_IMAGE } from "./preparation/proxy.js";
import { reuseSnapshot } from "./preparation/reuse.js";
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
  const supervisor = await ExecutionSupervisor.open(state);
  try {
    return await supervisor.withScan(async (scanId) => {
      const images = await localImages(state);
      const artifact = await new RegistryClient().resolve(name, version, options.signal);
      await installerImages();
      const signal = deadline(options.signal);
      const snapshot = await supervisor.prepare(artifact, scanId, signal);
      return await scanSnapshot(snapshot, images, state, signal, supervisor, scanId, {
        method: "prepared",
        previousGeneration: null,
      });
    });
  } finally {
    await supervisor.close();
  }
}

export async function checkCiPackage(
  spec: string,
  options: LocalOptions & { artifactFile: string; provenanceFile: string },
): Promise<CiReport> {
  const { name, version } = parsePackageSpec(spec);
  const state = await localState(options.stateDirectory);
  const provenance = ciProvenanceSchema.parse(
    parseBoundedJson(await readBoundedFile(resolve(options.provenanceFile), 16384), 16384),
  );
  const bytes = await readBoundedFile(resolve(options.artifactFile), 32 * 1024 ** 2);
  const artifact = ciArtifactSchema.parse({
    kind: "ci_artifact",
    name,
    version,
    provenance,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  });
  const supervisor = await ExecutionSupervisor.open(state);
  let staging: string | undefined;
  try {
    staging = join(state, "jobs", randomUUID());
    await mkdir(staging, { mode: 0o700 });
    const archive = join(staging, "artifact.tgz");
    await writeFile(archive, bytes, { flag: "wx", mode: 0o444 });
    await chmod(archive, 0o444);
    return await supervisor.withScan(async (scanId) => {
      const images = await localImages(state);
      await installerImages();
      const signal = deadline(options.signal);
      const snapshot = await supervisor.prepareCi(artifact, archive, scanId, signal);
      return scanSnapshot(snapshot, images, state, signal, supervisor, scanId, {
        method: "prepared",
        previousGeneration: null,
      });
    });
  } finally {
    try {
      await supervisor.close();
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
}

export async function reproduceReport(
  file: string,
  options: LocalOptions & { rebuild: boolean; lockFile?: string },
): Promise<LocalReport> {
  if (options.lockFile && !options.rebuild)
    throw new TypeError("An external lock requires --rebuild.");
  const report = parseReproductionInputs(
    parseBoundedJson(await readBoundedFile(resolve(file), MAX_REPORT_BYTES), MAX_REPORT_BYTES),
  );
  const state = await localState(options.stateDirectory);
  const supervisor = await ExecutionSupervisor.open(state);
  try {
    return await supervisor.withScan(async (scanId) => {
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
          options.lockFile
            ? resolve(options.lockFile)
            : join(state, "locks", `${report.snapshot.lockDigest}.json`),
          MAX_LOCK_BYTES,
        );
        if (validateLock(lockBytes, artifact).digest !== report.snapshot.lockDigest)
          throw new TypeError("The retained lock changed.");
        await installerImages();
        snapshot = await supervisor.prepare(artifact, scanId, signal, lockBytes);
      } else {
        supervisor.pinSnapshot(report.snapshot.id, scanId);
        snapshot = await reuseSnapshot(
          report.snapshot.id,
          join(state, "snapshots"),
          artifact,
          signal,
        );
        if (
          snapshot.generation !== report.snapshot.generation ||
          snapshot.lock.digest !== report.snapshot.lockDigest ||
          snapshot.tree.digest !== report.snapshot.treeDigest
        )
          throw new TypeError("The report snapshot identity changed.");
      }
      return await scanSnapshot(
        snapshot,
        report.images,
        state,
        signal,
        supervisor,
        scanId,
        {
          method: options.rebuild ? "rebuilt_from_lock" : "verified_reuse",
          previousGeneration: report.snapshot.generation,
        },
        "kind" in report ? report.assertion : report.assertion?.bundle,
      );
    });
  } finally {
    await supervisor.close();
  }
}

async function scanSnapshot(
  snapshot: PreparedSnapshot<CiArtifact>,
  images: RuntimeImage[],
  state: string,
  signal: AbortSignal,
  supervisor: ExecutionSupervisor,
  scanId: string,
  reproduction: LocalReport["reproduction"],
): Promise<CiReport>;
async function scanSnapshot(
  snapshot: PreparedSnapshot,
  images: RuntimeImage[],
  state: string,
  signal: AbortSignal,
  supervisor: ExecutionSupervisor,
  scanId: string,
  reproduction: LocalReport["reproduction"],
  assertion?: AssertionBundle,
): Promise<LocalReport>;
async function scanSnapshot(
  snapshot: PreparedSnapshot<ExecutionArtifact>,
  images: RuntimeImage[],
  state: string,
  signal: AbortSignal,
  supervisor: ExecutionSupervisor,
  scanId: string,
  reproduction: LocalReport["reproduction"],
  assertion?: AssertionBundle,
): Promise<LocalReport | CiReport> {
  const manifest = await readBoundedFile(
    join(snapshot.workspace, "node_modules", snapshot.artifact.name, "package.json"),
    2 * 1024 ** 2,
  );
  const plan = planProbes(
    manifest,
    images.map((image) => runtimeProfile(image.profileId)),
  );
  const backend = await supervisor.backend(snapshot, images, scanId);
  await mkdir(join(state, "locks"), { recursive: true, mode: 0o700 });
  await storeImmutable(
    join(state, "locks", `${snapshot.lock.digest}.json`),
    await readBoundedFile(join(snapshot.workspace, "package-lock.json"), MAX_LOCK_BYTES),
  );
  if (assertion) {
    assertion = validateAssertionBundle(assertion);
    if (
      assertion.manifest.packageName !== snapshot.artifact.name ||
      !matchingVersions([snapshot.artifact.version], assertion.manifest.packageRange).length
    )
      throw new TypeError("Assertion does not select this package version.");
  }
  const ci = "kind" in snapshot.artifact;
  const artifact =
    "kind" in snapshot.artifact
      ? snapshot.artifact
      : {
          name: snapshot.artifact.name,
          version: snapshot.artifact.version,
          integrity: snapshot.artifact.integrity,
          tarballUrl: snapshot.artifact.tarballUrl,
        };
  const initial = {
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    evidenceLevel: "static_only",
    harnessRevision: PROBE_HARNESS_REVISION,
    policyRevision: PROBE_POLICY_REVISION,
    artifact,
    ...(assertion ? { assertion: { bundle: assertion, evidence: [] } } : {}),
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
    cancelled: false,
  };
  const report = ci ? ciReportSchema.parse(initial) : localReportSchema.parse(initial);
  const evidenceBytes =
    MAX_REPORT_BYTES - Buffer.byteLength(JSON.stringify(report)) - (assertion ? 1024 ** 2 : 64);
  report.groups = await executePlan(plan, images, backend, signal, evidenceBytes);
  Object.assign(report, executionSummary(report.groups, signal));
  if ("assertion" in report && report.assertion) {
    let logsRemaining =
      MAX_SCAN_LOG_BYTES -
      report.groups.reduce(
        (sum, g) =>
          sum +
          g.sessions.reduce(
            (n, s) => n + Buffer.byteLength(s.logs.stdout) + Buffer.byteLength(s.logs.stderr),
            0,
          ),
        0,
      );
    for (const image of images) {
      if (signal.aborted) break;
      let evidence: AssertionEvidence;
      try {
        evidence = await supervisor.assertion(
          snapshot,
          image,
          report.assertion.bundle,
          scanId,
          signal,
        );
      } catch (error) {
        if (signal.aborted && error === signal.reason) break;
        throw error;
      }
      for (const stream of ["stdout", "stderr"] as const) {
        const bytes = Buffer.from(evidence.session.logs[stream]);
        evidence.session.logs[stream] = new TextDecoder().decode(
          bytes.subarray(0, Math.max(0, logsRemaining)),
          { stream: true },
        );
        evidence.session.logs[`${stream}Truncated`] ||= bytes.length > logsRemaining;
        logsRemaining -= Math.min(bytes.length, Math.max(0, logsRemaining));
      }
      report.assertion.evidence.push(evidence);
    }
    Object.assign(report, executionSummary(report.groups, signal));
  }
  const bytes = Buffer.from(JSON.stringify(report));
  if (bytes.length > MAX_REPORT_BYTES) throw new TypeError("The local report exceeds 20 MiB.");
  (ci ? ciReportSchema : localReportSchema).parse(report);
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
