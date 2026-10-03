import { JsonStructureLimit } from "../registry/json-limits.js";
import { isRecord } from "../registry/validation.js";
import { PreparationError } from "./lock.js";

export function parseInstalledManifest(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength > 2 * 1024 ** 2)
    throw new PreparationError("preparation_limit_exceeded", "Installed manifest exceeds 2 MiB.");
  new JsonStructureLimit().write(bytes);
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
    if (isRecord(value)) return value;
  } catch {
    /* Invalid manifests use the same bounded failure below. */
  }
  throw new PreparationError("package_manifest_invalid", "Installed package metadata is invalid.");
}
