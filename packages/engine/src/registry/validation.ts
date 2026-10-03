import { valid } from "semver";
import ssri from "ssri";
import validatePackageName from "validate-npm-package-name";
import { RegistryError } from "./errors.js";

export const REGISTRY_ORIGIN = "https://registry.npmjs.org";

export function assertPackageName(name: string): void {
  if (
    typeof name !== "string" ||
    name.length > 214 ||
    !validatePackageName(name).validForOldPackages
  ) {
    throw new TypeError("Expected a valid public npm package name.");
  }
}

export function isExactVersion(version: unknown): version is string {
  return (
    typeof version === "string" &&
    version.length <= 256 &&
    /^[0-9]/.test(version) &&
    version === version.trim() &&
    valid(version) !== null
  );
}

export function assertSelector(selector: string): void {
  if (
    typeof selector !== "string" ||
    (!isExactVersion(selector) && !/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(selector))
  ) {
    throw new TypeError("Select an exact version or a dist-tag; version ranges are not supported.");
  }
}

export function registryTarballUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value)) {
    throw new RegistryError("dependency_source_unsupported", "The artifact URL is not supported.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RegistryError("dependency_source_unsupported", "The artifact URL is not supported.");
  }
  if (url.origin !== REGISTRY_ORIGIN || url.username || url.password || url.search || url.hash) {
    throw new RegistryError(
      "dependency_source_unsupported",
      "Artifacts must use the public npm registry without credentials.",
    );
  }
  return url.href;
}

export function artifactIntegrity(value: unknown): string {
  if (typeof value === "string" && value.length <= 1024) {
    const parsed = ssri.parse(value, { strict: true });
    if (parsed) {
      for (const [algorithm, length] of [
        ["sha512", 64],
        ["sha384", 48],
        ["sha256", 32],
      ] as const) {
        const hashes = parsed[algorithm];
        if (!hashes?.length) continue;
        const hash = hashes[0];
        if (hashes.length === 1 && hash && Buffer.from(hash.digest, "base64").length === length) {
          return `${algorithm}-${hash.digest}`;
        }
        break;
      }
    }
  }
  throw new RegistryError(
    "artifact_integrity_unavailable",
    "A single usable SHA-256, SHA-384 or SHA-512 artifact digest is required.",
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
