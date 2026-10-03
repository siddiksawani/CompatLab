import { createHash } from "node:crypto";
import type { ResolvedArtifact } from "../registry/client.js";
import { JsonStructureLimit } from "../registry/json-limits.js";
import {
  artifactIntegrity,
  assertPackageName,
  isExactVersion,
  isRecord,
  registryTarballUrl,
} from "../registry/validation.js";

export type PreparationClassification =
  | "dependency_source_unsupported"
  | "artifact_integrity_mismatch"
  | "artifact_integrity_unavailable"
  | "package_manifest_invalid"
  | "archive_rejected"
  | "dependency_install_failed"
  | "preparation_limit_exceeded"
  | "runner_unavailable";
export class PreparationError extends Error {
  override readonly name = "PreparationError";
  constructor(
    readonly classification: PreparationClassification,
    message: string,
    readonly diagnostics?: string,
  ) {
    super(message);
  }
}

export type LockedDependency = {
  location: string;
  version: string;
  bundled: boolean;
  optional: boolean;
  hasInstallScript: boolean;
  integrity?: string;
  resolved?: string;
};
export type ValidatedLock = { digest: string; dependencies: LockedDependency[] };
export const MAX_LOCK_BYTES = 16 * 1024 * 1024;

export function validateLock(
  bytes: Uint8Array,
  artifact: Pick<ResolvedArtifact, "name" | "version" | "integrity" | "tarballUrl">,
): ValidatedLock {
  if (bytes.byteLength > MAX_LOCK_BYTES)
    fail("preparation_limit_exceeded", "The lock exceeds 16 MiB.");
  new JsonStructureLimit().write(bytes);
  let lock: unknown;
  try {
    lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("package_manifest_invalid", "The installer produced an invalid lock.");
  }
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages))
    return fail("package_manifest_invalid", "A version 3 npm lock is required.");
  const project = lock.packages[""];
  if (
    !isRecord(project) ||
    !isRecord(project.dependencies) ||
    Object.keys(project.dependencies).length !== 1 ||
    project.dependencies[artifact.name] !== artifact.version
  )
    return fail(
      "package_manifest_invalid",
      "The consumer lock does not match the selected dependency.",
    );
  const records = Object.entries(lock.packages).filter(([location]) => location !== "");
  if (records.length > 10_000)
    fail("preparation_limit_exceeded", "The dependency count exceeds 10,000.");
  const dependencies: LockedDependency[] = [];
  const verified = new Set<string>();
  for (const [location, entry] of records) {
    assertLocation(location);
    if (!isRecord(entry) || entry.link || !isExactVersion(entry.version))
      return fail(
        "dependency_source_unsupported",
        "Links and unresolved dependency records are not supported.",
      );
    const dependency: LockedDependency = {
      location,
      version: entry.version,
      bundled: entry.inBundle === true,
      optional: entry.optional === true || entry.devOptional === true,
      hasInstallScript: entry.hasInstallScript === true,
    };
    if (!dependency.bundled) {
      dependency.resolved = registryTarballUrl(entry.resolved);
      dependency.integrity = artifactIntegrity(entry.integrity);
      verified.add(location);
    } else if (entry.resolved !== undefined || entry.integrity !== undefined) {
      return fail(
        "dependency_source_unsupported",
        "Bundled records must inherit their containing artifact.",
      );
    }
    dependencies.push(dependency);
  }
  for (const dependency of dependencies) {
    if (!dependency.bundled) continue;
    let ancestor = dependency.location;
    while (ancestor.includes("/node_modules/")) {
      ancestor = ancestor.slice(0, ancestor.lastIndexOf("/node_modules/"));
      if (verified.has(ancestor)) break;
    }
    if (!verified.has(ancestor))
      fail(
        "dependency_source_unsupported",
        "A bundled dependency has no verified containing artifact.",
      );
  }
  const root = dependencies.find((entry) => entry.location === `node_modules/${artifact.name}`);
  if (
    !root ||
    root.bundled ||
    root.version !== artifact.version ||
    root.resolved !== registryTarballUrl(artifact.tarballUrl)
  )
    return fail("package_manifest_invalid", "The root lock identity changed during resolution.");
  if (root.integrity !== artifactIntegrity(artifact.integrity))
    fail(
      "artifact_integrity_mismatch",
      "The selected artifact integrity changed during resolution.",
    );
  return { digest: createHash("sha256").update(bytes).digest("hex"), dependencies };
}

function assertLocation(location: string): void {
  if (location.length > 2048 || !location.startsWith("node_modules/"))
    fail("dependency_source_unsupported", "Invalid installed dependency path.");
  try {
    for (const name of location.slice("node_modules/".length).split("/node_modules/"))
      assertPackageName(name);
  } catch {
    fail("dependency_source_unsupported", "Invalid installed dependency path.");
  }
}

function fail(classification: PreparationClassification, message: string): never {
  throw new PreparationError(classification, message);
}
