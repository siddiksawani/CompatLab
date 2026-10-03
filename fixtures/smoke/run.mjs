import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const [scenario, probeId, mode] = process.argv.slice(2);
assert.equal(process.getuid(), 65534);
assert.ok(mode === "esm" || mode === "commonjs");
await assert.rejects(writeFile("/fixture/esm.mjs", "blocked"), { code: "EROFS" });

const started = performance.now();
const completion = {
  schemaVersion: 1,
  probeId,
  mode,
  completed: true,
  outcome: "pass",
  durationMs: 0,
};

if (scenario === "fake_stdout") {
  process.stdout.write(JSON.stringify(completion));
} else if (scenario !== "missing_result") {
  try {
    if (scenario === "module_failure") await import("./failure.mjs");
    else if (mode === "esm") await import("./esm.mjs");
    else createRequire(import.meta.url)("./commonjs.cjs");
  } catch (error) {
    completion.outcome = "fail";
    completion.error = { name: error.name, message: error.message };
  }
  completion.durationMs = performance.now() - started;
  await writeFile("/output/result.json", JSON.stringify(completion));
}

if (scenario === "abnormal_exit") process.exitCode = 7;
