import { describe, expect, it } from "vitest";
import {
  manifestObservations,
  planProbes,
  RUNTIME_PROFILES,
  runtimeArguments,
  runtimeProfile,
} from "../src/index.js";

const manifest = (fields: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ name: "@scope/fixture", version: "1.0.0", ...fields }));
const profile = runtimeProfile("node_24_21_0");
const plan = (fields: Record<string, unknown>) => planProbes(manifest(fields), [profile]);

describe("public entry planning", () => {
  it.each([
    "./index.mjs",
    { node: "./index.mjs" },
    { "module-sync": "./index.mjs" },
    { default: "./index.mjs" },
  ])("attempts require for accessible ESM exports %j", (exports) => {
    const root = plan({ type: "module", exports }).runtimes[0]?.root;
    expect(root?.esm).toMatchObject({ applicable: true });
    expect(root?.commonjs).toMatchObject({ applicable: true });
  });
  it("preserves condition order, nested modes and array fallback", () => {
    const root = plan({ exports: { default: "./first.cjs", import: "./later.mjs" } }).runtimes[0]
      ?.root;
    expect(root?.esm).toEqual({ applicable: true, reason: "public_target", target: "./first.cjs" });
    const modes = plan({
      exports: { browser: "./web.js", node: { import: "./esm.mjs", require: [null, "./cjs.cjs"] } },
    }).runtimes[0]?.root;
    expect(modes?.esm).toMatchObject({ target: "./esm.mjs" });
    expect(modes?.commonjs).toMatchObject({ target: "./cjs.cjs" });
  });
  it("keeps runtime-specific conditions independent", () => {
    const result = planProbes(
      manifest({ exports: { bun: "./bun.js", deno: "./deno.js", node: "./node.js" } }),
      RUNTIME_PROFILES,
    );
    expect(result.runtimes.map((runtime) => runtime.root.esm)).toEqual([
      expect.objectContaining({ target: "./node.js" }),
      expect.objectContaining({ target: "./node.js" }),
      expect.objectContaining({ target: "./bun.js" }),
      expect.objectContaining({ target: "./deno.js" }),
    ]);
  });
  it("records stable explicit order and exclusions without expanding patterns", () => {
    const result = plan({
      exports: {
        "./z": "./z.js",
        "./a": { import: "./a.mjs" },
        "./style": "./style.css",
        "./types": "./index.d.ts",
        "./pattern/*": "./*.js",
        "./private": null,
        "./../escape": "./bad.js",
      },
    });
    expect(result.runtimes[0]?.root.esm).toEqual({ applicable: false, reason: "not_exported" });
    expect(result.runtimes[0]?.entries.map((entry) => entry.subpath)).toEqual(["./z", "./a"]);
    expect(result.runtimes[0]?.entries[1]?.commonjs).toEqual({
      applicable: false,
      reason: "not_exported",
    });
    expect(result.omissions.counts).toEqual({
      pattern: 1,
      non_executable: 2,
      not_exported: 1,
      invalid_subpath: 1,
      coverage_limit: 0,
    });
  });
  it("attempts malformed exports and legacy mains for runtime resolution evidence", () => {
    for (const exports of [42, { ".": "./index.js", import: "./other.js" }, "../invalid.js"])
      expect(plan({ exports }).runtimes[0]?.root.esm).toEqual({
        applicable: true,
        reason: "resolution_required",
      });
    expect(
      plan({ type: "module", main: "./missing.js", module: "./alternate.js" }).runtimes[0]?.root
        .commonjs,
    ).toEqual({ applicable: true, reason: "resolution_required" });
  });
  it("limits executable subpaths, bounds omission samples, and supports variable matrices", () => {
    const exports: Record<string, string> = {};
    for (let index = 0; index < 600; index++) exports[`./entry-${index}`] = `./entry-${index}.js`;
    for (const count of [1, 3, 4]) {
      const result = planProbes(manifest({ exports }), RUNTIME_PROFILES.slice(0, count));
      expect(result.runtimes).toHaveLength(count);
      expect(result.runtimes.every((runtime) => runtime.entries.length === 512)).toBe(true);
      expect(result.omissions.counts.coverage_limit).toBe(88);
      expect(result.omissions.samples).toHaveLength(64);
    }
    expect(() => planProbes(manifest(), [])).toThrow();
    expect(() => planProbes(manifest(), [profile, profile])).toThrow();
  });
});

it("retains native and lifecycle indicators without treating them as proven prerequisites", () => {
  const value = manifest({
    scripts: { install: "node-gyp rebuild", test: "test" },
    os: ["linux", "!darwin"],
    cpu: ["!x64"],
    libc: "invalid",
    peerDependencies: { peer: "*" },
    exports: "./index.js",
  });
  const result = manifestObservations(value, [
    "node_modules/fixture/addon.node",
    "node_modules/fixture/binding.gyp",
  ]);
  expect(result.lifecycleScripts).toEqual(["install"]);
  expect(result.native).toMatchObject({ count: 1, prerequisiteProven: false });
  expect(result.platform).toEqual({ os: true, cpu: false, libc: null });
  expect(result.declared.peerDependencies).toEqual({ peer: "*" });
});

it("pins runtime flags and refuses arbitrary harness paths", () => {
  const script = "/workspace/.compatlab/probe.mjs";
  expect(runtimeArguments("node", script)).toEqual([script]);
  expect(runtimeArguments("bun", script)).toEqual(["run", "--no-install", script]);
  expect(runtimeArguments("deno", script)).toEqual([
    "run",
    "-A",
    "--no-config",
    "--no-lock",
    "--node-modules-dir=manual",
    "--cached-only",
    script,
  ]);
  expect(() => runtimeArguments("node", "--eval=malicious")).toThrow();
  expect(() => runtimeProfile("unknown")).toThrow();
});
