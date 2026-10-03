import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kind = process.argv[2];
const observations = [];
for (const id of [
  "cjs",
  "esm",
  "tla",
  "conditions",
  "order",
  "native",
  "prerequisite",
  "node-addons",
  "module-sync",
]) {
  for (const mode of ["esm", "commonjs"]) {
    let value;
    let failed = false;
    try {
      value =
        mode === "esm"
          ? await import(`compatlab-fixture-${id}`)
          : require(`compatlab-fixture-${id}`);
    } catch (error) {
      failed = true;
      if (id !== "prerequisite" && !(id === "tla" && mode === "commonjs")) throw error;
      observations.push({
        id,
        mode,
        outcome: "fail",
        code: error.code ?? null,
        message: error.message,
      });
    }
    if (!failed) {
      assert.notEqual(id, "prerequisite", "A missing native file must fail.");
      assert.ok(
        !(id === "tla" && mode === "commonjs"),
        "A TLA module unexpectedly supported synchronous require.",
      );
      const expected = id === "conditions" ? kind : id === "order" ? "first" : id;
      assert.equal(mode === "esm" ? (value.default ?? value).value : value.value, expected);
      observations.push({ id, mode, outcome: "pass" });
    }
  }
}
await assert.rejects(() => import("compatlab-fixture-never-installed"));
for (const path of [
  "/bin/sh",
  "/usr/bin/npm",
  "/usr/local/bin/npm",
  "/usr/bin/gcc",
  "/var/run/docker.sock",
])
  assert.equal(existsSync(path), false, `Unexpected runtime tool or socket: ${path}`);
assert.throws(() => writeFileSync("/workspace/mutated", "unsafe"), { code: "EROFS" });
mkdirSync("/tmp/private", { recursive: true });
writeFileSync("/tmp/private/writable", "allowed");
let denoCacheFiles = null;
if (kind === "deno") {
  assert.equal((await import("../typed.ts")).default, 42);
  const cache = process.env.DENO_DIR;
  assert.equal(cache, "/tmp/deno");
  denoCacheFiles = readdirSync(cache, { recursive: true }).length;
  assert.ok(denoCacheFiles > 0, "Deno did not create its private derived cache.");
}
writeFileSync(
  "/output/result.json",
  JSON.stringify({ kind, observations, denoCacheFiles, offlineMissingDependency: true }),
);
