import { JsonStructureLimit } from "../registry/json-limits.js";
import { isRecord } from "../registry/validation.js";
import { PreparationError, preparationBoundary } from "./lock.js";

export function parseInstalledManifest(
  bytes: Uint8Array,
  expected?: { name: string; version: string },
): Record<string, unknown> {
  if (bytes.byteLength > 2 * 1024 ** 2)
    throw new PreparationError("preparation_limit_exceeded", "Installed manifest exceeds 2 MiB.");
  preparationBoundary(() => new JsonStructureLimit().write(bytes));
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
    if (
      isRecord(value) &&
      (!expected || (value.name === expected.name && value.version === expected.version))
    )
      return value;
  } catch {
    /* Invalid manifests use the same bounded failure below. */
  }
  throw new PreparationError("package_manifest_invalid", "Installed package metadata is invalid.");
}
