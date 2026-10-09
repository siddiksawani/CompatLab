import { assertPackageName, isExactVersion } from "@compatlab/engine";

export function parsePackagePath(raw: string[]) {
  if (raw.length < 2 || raw.length > 3) return null;
  try {
    // Next can supply encoded page params and decoded metadata params for the same route.
    const parts = raw.map((part) => decodeURIComponent(part));
    if (parts.some((part) => /[\\/]/.test(part))) return null;
    const name = parts.slice(0, -1).join("/");
    const version = parts.at(-1);
    assertPackageName(name);
    return isExactVersion(version) ? { name, version } : null;
  } catch {
    return null;
  }
}
