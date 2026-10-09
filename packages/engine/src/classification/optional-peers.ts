import type { LoadObservation, NormalizedFailure } from "@compatlab/contracts";
import { assertPackageName, isRecord } from "../registry/validation.js";

export type OptionalPeerContext = ReadonlyMap<string, string>;

export function optionalPeerContext(
  packageName: string,
  manifest: unknown,
  installed: unknown,
): OptionalPeerContext {
  const missing = new Map<string, string>();
  if (
    !isRecord(manifest) ||
    manifest.name !== packageName ||
    !isRecord(manifest.peerDependencies) ||
    !isRecord(manifest.peerDependenciesMeta) ||
    !Array.isArray(installed) ||
    installed.length > 10_000 ||
    !installed.includes(`node_modules/${packageName}`)
  )
    return missing;
  const present = new Set<string>();
  for (const location of installed) {
    if (
      typeof location !== "string" ||
      location.length > 2048 ||
      !location.startsWith("node_modules/")
    )
      return missing;
    const names = location.slice("node_modules/".length).split("/node_modules/");
    if (names.some((name) => !packageSpecifier(name, false))) return missing;
    const name = names.at(-1);
    if (name) present.add(name);
  }
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    const meta = Object.hasOwn(manifest.peerDependenciesMeta, name)
      ? manifest.peerDependenciesMeta[name]
      : undefined;
    if (
      packageSpecifier(name, false) &&
      typeof range === "string" &&
      range.length > 0 &&
      range.length <= 256 &&
      /^[\x20-\x7e]+$/.test(range) &&
      isRecord(meta) &&
      meta.optional === true &&
      !present.has(name)
    )
      missing.set(name, range);
  }
  return missing;
}

export function missingOptionalPeer(
  error: Extract<LoadObservation, { outcome: "fail" }>["error"],
  context: OptionalPeerContext | undefined,
): NormalizedFailure["optionalPeer"] {
  if (!context?.size) return undefined;
  const { code, message } = error;
  let requested: string | undefined;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
    requested =
      /^Cannot find package ['"]([^'"\r\n]+)['"] imported from [^\r\n]+$/.exec(message)?.[1] ??
      /^Cannot find module ['"]([^'"\r\n]+)['"](?:\r?\nRequire stack:[\s\S]*)?$/.exec(
        message,
      )?.[1] ??
      /^Could not find package ['"]([^'"\r\n]+)['"] from referrer ['"][^\r\n]+['"]\.?$/.exec(
        message,
      )?.[1];
  } else if (code === null) {
    requested =
      /^(?:[A-Za-z_$][\w.$]*\(\) error: )?missing ['"]([^'"\r\n]+)['"] dependency\.$/.exec(
        message,
      )?.[1];
  }
  const name = requested ? packageSpecifier(requested, true) : undefined;
  const range = name ? context.get(name) : undefined;
  return name && range ? { name, range } : undefined;
}

function packageSpecifier(value: string, allowSubpath: boolean): string | undefined {
  const parts = value.split("/");
  const name = parts.slice(0, value.startsWith("@") ? 2 : 1).join("/");
  if (
    (!allowSubpath && name !== value) ||
    parts.some((part) => !part || part === "." || part === "..") ||
    /[\\\s?#%]/.test(value)
  )
    return undefined;
  try {
    assertPackageName(name);
    return name;
  } catch {
    return undefined;
  }
}
