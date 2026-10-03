import type { ProbeMode, RuntimeKind } from "@compatlab/contracts";

export const RUNTIME_BASE_IMAGE =
  "gcr.io/distroless/cc-debian13:nonroot@sha256:20afe6a70f2565277b704cc17289cb557f353a3619f6350f52a2317106598df4";
export type RuntimeProfile = {
  id: string;
  kind: RuntimeKind;
  version: string;
  channel: "lts" | "current" | "stable";
  sourceImage: string;
  binary: string;
};
export const RUNTIME_PROFILES: readonly RuntimeProfile[] = [
  {
    id: "node_24_21_0",
    kind: "node",
    version: "24.21.0",
    channel: "lts",
    sourceImage:
      "node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7",
    binary: "/usr/local/bin/node",
  },
  {
    id: "node_26_10_0",
    kind: "node",
    version: "26.10.0",
    channel: "current",
    sourceImage:
      "node:26.10.0-bookworm-slim@sha256:0a992e1420e2d70611578f1844a6f10a9d11fe6bb535aabf72efe3007f13d79b",
    binary: "/usr/local/bin/node",
  },
  {
    id: "bun_1_4_2",
    kind: "bun",
    version: "1.4.2",
    channel: "stable",
    sourceImage:
      "oven/bun:1.4.2-debian@sha256:53710ce0f14eef8312521c586a7ae1d9aeab4011840f09f1966073b68fc2e2ab",
    binary: "/usr/local/bin/bun",
  },
  {
    id: "deno_2_9_7",
    kind: "deno",
    version: "2.9.7",
    channel: "stable",
    sourceImage:
      "denoland/deno:debian-2.9.7@sha256:869d374bdaddda4fde029c492d7219199b0e821c2c53cca5357b3a6f5b9336fc",
    binary: "/usr/bin/deno",
  },
];

export function runtimeProfile(id: string): RuntimeProfile {
  const profile = RUNTIME_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new TypeError("The runtime profile is not approved.");
  return profile;
}

export function runtimeArguments(kind: RuntimeKind, script: string): string[] {
  if (!/^\/workspace\/\.compatlab\/[a-z-]+\.mjs$/.test(script))
    throw new TypeError("Runtime scripts must come from the trusted harness mount.");
  switch (kind) {
    case "node":
      return [script];
    case "bun":
      return ["run", "--no-install", script];
    case "deno":
      return [
        "run",
        "-A",
        "--no-config",
        "--no-lock",
        "--node-modules-dir=manual",
        "--cached-only",
        script,
      ];
  }
}

export function exportConditions(kind: RuntimeKind, mode: ProbeMode): Set<string> {
  return new Set([
    "default",
    "node",
    "node-addons",
    "module-sync",
    mode === "esm" ? "import" : "require",
    ...(kind === "node" ? [] : [kind]),
  ]);
}

export const RUNTIME_ENVIRONMENT = {
  HOME: "/tmp/home",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  TZ: "UTC",
  NODE_OPTIONS: "",
  NODE_PATH: "",
  DENO_DIR: "/tmp/deno",
  DENO_NO_UPDATE_CHECK: "1",
  DENO_CONDITIONS: "",
  BUN_INSTALL_CACHE_DIR: "/tmp/bun",
  BUN_OPTIONS: "",
} as const;
