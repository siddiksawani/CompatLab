import {
  MAX_SUBPATHS,
  type OmissionReason,
  type PlannedEntry,
  PROBE_PLAN_REVISION,
  type ProbePlan,
  probePlanSchema,
} from "@compatlab/contracts";
import { PreparationError } from "../preparation/lock.js";
import { parseInstalledManifest } from "../preparation/manifest.js";
import { assertPackageName, isExactVersion, isRecord } from "../registry/validation.js";
import { exportConditions, type RuntimeProfile } from "../runtime/profiles.js";
import { applicability, executableTarget } from "./exports.js";

export function planProbes(bytes: Uint8Array, profiles: readonly RuntimeProfile[]): ProbePlan {
  const manifest = parseInstalledManifest(bytes);
  if (typeof manifest.name !== "string")
    throw new PreparationError("package_manifest_invalid", "A package name is required.");
  assertPackageName(manifest.name);
  if (!isExactVersion(manifest.version))
    throw new PreparationError(
      "package_manifest_invalid",
      "An exact installed version is required.",
    );
  if (
    profiles.length < 1 ||
    profiles.length > 16 ||
    new Set(profiles.map((profile) => profile.id)).size !== profiles.length
  )
    throw new TypeError("Select one to sixteen distinct runtime profiles.");
  const name = manifest.name;
  const exported = manifest.exports;
  const subpathMap = isRecord(exported) && Object.keys(exported).some((key) => key.startsWith("."));
  const mixedMap = subpathMap && Object.keys(exported).some((key) => !key.startsWith("."));
  const rootValue = subpathMap ? (exported["."] ?? null) : exported;
  const entry = (subpath: string, value: unknown, profile: RuntimeProfile): PlannedEntry => ({
    subpath,
    specifier: subpath === "." ? name : `${name}/${subpath.slice(2)}`,
    esm: applicability(value, exportConditions(profile.kind, "esm")),
    commonjs: applicability(value, exportConditions(profile.kind, "commonjs")),
  });
  const runtimes = profiles.map((profile) => {
    const root = entry(".", mixedMap ? false : rootValue, profile);
    if (exported === undefined || exported === null) {
      const main = typeof manifest.main === "string" ? manifest.main : "index.js";
      const mode = executableTarget(main)
        ? { applicable: true as const, reason: "resolution_required" as const }
        : { applicable: false as const, reason: "non_executable" as const };
      root.esm = mode;
      root.commonjs = mode;
    }
    return { profileId: profile.id, root, entries: [] as PlannedEntry[] };
  });
  const omissions: ProbePlan["omissions"] = {
    counts: {
      pattern: 0,
      non_executable: 0,
      not_exported: 0,
      invalid_subpath: 0,
      coverage_limit: 0,
    },
    samples: [],
  };
  function omit(subpath: string, reason: OmissionReason) {
    omissions.counts[reason]++;
    if (omissions.samples.length < 64)
      omissions.samples.push({ subpath: subpath.slice(0, 2048), reason });
  }
  let count = 0;
  if (subpathMap)
    for (const subpath in exported) {
      if (subpath === ".") continue;
      if (subpath.includes("*")) {
        omit(subpath, "pattern");
        continue;
      }
      if (!validSubpath(subpath)) {
        omit(subpath, "invalid_subpath");
        continue;
      }
      const entries = profiles.map((profile) =>
        entry(subpath, mixedMap ? false : exported[subpath], profile),
      );
      if (
        entries.every((candidate) => !candidate.esm.applicable && !candidate.commonjs.applicable)
      ) {
        omit(
          subpath,
          entries.some(
            (candidate) =>
              candidate.esm.reason === "non_executable" ||
              candidate.commonjs.reason === "non_executable",
          )
            ? "non_executable"
            : "not_exported",
        );
        continue;
      }
      if (count >= MAX_SUBPATHS) {
        omit(subpath, "coverage_limit");
        continue;
      }
      count++;
      for (const [index, candidate] of entries.entries()) runtimes[index]?.entries.push(candidate);
    }
  const plan = {
    schemaVersion: 1 as const,
    revision: PROBE_PLAN_REVISION,
    name,
    version: manifest.version,
    runtimes,
    omissions,
  };
  if (Buffer.byteLength(JSON.stringify(plan)) > 8 * 1024 ** 2)
    throw new PreparationError("preparation_limit_exceeded", "The probe plan exceeds 8 MiB.");
  return probePlanSchema.parse(plan);
}

function validSubpath(path: string): boolean {
  return (
    path.length <= 2048 &&
    path.startsWith("./") &&
    !/[\\?#%]/.test(path) &&
    !Array.from(path).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) &&
    path
      .slice(2)
      .split("/")
      .every((part) => part && part !== "." && part !== ".." && part !== "node_modules")
  );
}
