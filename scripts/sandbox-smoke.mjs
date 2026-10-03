import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCompletion } from "../packages/contracts/dist/index.js";
import { inspectDocker } from "../services/worker/dist/index.js";

const environment = await inspectDocker();
assert.ok(
  environment.prerequisitesAvailable,
  `The smoke test requires Linux amd64 Docker with runsc: ${JSON.stringify(environment)}`,
);

const docker = (args, timeout = 45_000) =>
  execFileSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 128 * 1024 });

const image = docker(["build", "--quiet", "fixtures/smoke"], 180_000).trim();
assert.match(image, /^sha256:[a-f0-9]{64}$/);

const cases = [
  ["success", "esm", "pass"],
  ["success", "commonjs", "pass"],
  ["module_failure", "esm", "fail"],
  ["fake_stdout", "esm", "harness_protocol_error"],
  ["missing_result", "esm", "harness_protocol_error"],
  ["abnormal_exit", "esm", "unexpected_process_exit"],
];

for (const [scenario, mode, expected] of cases) {
  const probeId = randomUUID();
  const name = `compatlab-smoke-${probeId}`;
  const output = await mkdtemp(join(tmpdir(), "compatlab-smoke-"));
  await chmod(output, 0o777);
  let exitCode = 0;
  try {
    try {
      docker([
        "run",
        "--name",
        name,
        "--pull=never",
        "--runtime=runsc",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=65534:65534",
        "--memory=1g",
        "--memory-swap=1g",
        "--cpus=1",
        "--pids-limit=128",
        "--ulimit=fsize=65536:65536",
        "--tmpfs=/tmp:rw,nosuid,nodev,size=64m",
        "--mount",
        `type=bind,src=${output},dst=/output`,
        image,
        scenario,
        probeId,
        mode,
      ]);
    } catch (error) {
      if (typeof error.status !== "number" || error.status === 0) throw error;
      exitCode = error.status;
    }
    assert.equal(exitCode, scenario === "abnormal_exit" ? 7 : 0);
    const fileContents = await readFile(join(output, "result.json")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const result = evaluateCompletion({
      exitCode,
      fileContents,
      expectedProbeId: probeId,
      expectedMode: mode,
    });
    assert.equal(result.accepted ? result.observation.outcome : result.classification, expected);
    process.stdout.write(`${scenario} (${mode}): ${expected}\n`);
  } finally {
    docker(["rm", "--force", name]);
    await rm(output, { recursive: true, force: true });
  }
}
