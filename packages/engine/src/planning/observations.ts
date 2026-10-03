import { parseInstalledManifest } from "../preparation/manifest.js";
import { isRecord } from "../registry/validation.js";

const fields = [
  "type",
  "main",
  "module",
  "exports",
  "imports",
  "engines",
  "os",
  "cpu",
  "libc",
  "bin",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "bundledDependencies",
  "bundleDependencies",
  "scripts",
];

export function manifestObservations(bytes: Uint8Array, files: readonly string[]) {
  const manifest = parseInstalledManifest(bytes);
  const declared: Record<string, unknown> = {};
  for (const field of fields) if (Object.hasOwn(manifest, field)) declared[field] = manifest[field];
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const nativeFiles = files.filter((file) => file.endsWith(".node"));
  const buildFiles = files.filter((file) =>
    /(?:^|\/)(?:binding\.gyp|CMakeLists\.txt|Cargo\.toml)$/.test(file),
  );
  return {
    evidenceLevel: "static_only" as const,
    declared,
    lifecycleScripts: ["preinstall", "install", "postinstall", "prepare"].filter(
      (name) => typeof scripts[name] === "string",
    ),
    native: {
      count: nativeFiles.length,
      paths: nativeFiles.slice(0, 64),
      buildIndicators: buildFiles.slice(0, 64),
      prerequisiteProven: false as const,
    },
    platform: {
      os: matches(manifest.os, "linux"),
      cpu: matches(manifest.cpu, "x64"),
      libc: matches(manifest.libc, "glibc"),
    },
  };
}

function matches(value: unknown, platform: string): boolean | null {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  if (value.includes(`!${platform}`)) return false;
  const positive = value.filter((item: string) => !item.startsWith("!"));
  return positive.length === 0 || positive.includes(platform) || positive.includes("any");
}
