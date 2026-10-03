import type { Applicability } from "@compatlab/contracts";
import { isRecord } from "../registry/validation.js";

type Selection =
  | { kind: "target"; path: string }
  | { kind: "blocked" }
  | { kind: "unmatched" }
  | { kind: "uncertain" };

export function selectExport(
  value: unknown,
  conditions: ReadonlySet<string>,
  depth = 0,
): Selection {
  if (depth > 32) return { kind: "uncertain" };
  if (value === null) return { kind: "blocked" };
  if (typeof value === "string")
    return value.startsWith("./") && value.length <= 2048
      ? { kind: "target", path: value }
      : { kind: "uncertain" };
  if (Array.isArray(value)) {
    for (const option of value) {
      const result = selectExport(option, conditions, depth + 1);
      if (result.kind === "target" || result.kind === "uncertain") return result;
    }
    return { kind: "blocked" };
  }
  if (!isRecord(value)) return { kind: "uncertain" };
  for (const key in value) {
    if (/^\d+$/.test(key) || key.startsWith(".")) return { kind: "uncertain" };
    if (!conditions.has(key)) continue;
    const result = selectExport(value[key], conditions, depth + 1);
    if (result.kind !== "unmatched") return result;
  }
  return { kind: "unmatched" };
}

export function applicability(value: unknown, conditions: ReadonlySet<string>): Applicability {
  const result = selectExport(value, conditions);
  if (result.kind === "blocked" || result.kind === "unmatched")
    return { applicable: false, reason: "not_exported" };
  if (result.kind === "uncertain") return { applicable: true, reason: "resolution_required" };
  return executableTarget(result.path)
    ? { applicable: true, reason: "public_target", target: result.path }
    : { applicable: false, reason: "non_executable" };
}

export function executableTarget(path: string): boolean {
  return !/(?:\.d\.[cm]?ts|\.(?:json|css|scss|sass|less|html|md|txt|map|svg|png|jpe?g|gif|webp|woff2?|ttf|ico))$/i.test(
    path.split(/[?#]/, 1)[0] ?? "",
  );
}
