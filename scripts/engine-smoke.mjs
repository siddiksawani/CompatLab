import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { corpus, createCorpus, liveCorpus, protocolCases } from "../fixtures/engine/corpus.mjs";
import { PROBE_LIMITS } from "../packages/contracts/dist/index.js";
import {
  executePlan,
  planProbes,
  RegistryClient,
  runtimeProfile,
} from "../packages/engine/dist/index.js";
import { command, docker } from "../services/worker/dist/command.js";
import {
  buildRuntimeImages,
  createProbeBackend,
  INSTALLER_IMAGE,
  inspectTree,
  PROXY_IMAGE,
  prepareArtifact,
  WorkspaceVolume,
} from "../services/worker/dist/index.js";

const profile = runtimeProfile(process.argv[2]);
const images = await buildRuntimeImages([profile.id]);
const base = await mkdtemp(join(tmpdir(), "compatlab-engine-"));
const volume = await WorkspaceVolume.create(join(base, randomUUID()), 128 * 1024 ** 2, 8192);
const workspace = join(volume.path, "workspace");
const cliState = join(base, "cli");
try {
  await mkdir(workspace);
  await createCorpus(workspace);
  await command("cc", [
    "-shared",
    "-fPIC",
    "-I",
    resolve(dirname(process.execPath), "../include/node"),
    "fixtures/runtime/addon.c",
    "-o",
    join(workspace, "node_modules/compatlab-fixture-native-shipped/addon.node"),
  ]);
  const originalTree = await inspectTree(workspace);
  await volume.seal();
  const backend = await createProbeBackend(workspace, join(base, "jobs"), images);
  assert.equal(corpus.length + liveCorpus.length, 50);
  for (const [id, expected] of corpus) {
    const report = await runFixture(id, backend);
    assert.deepEqual(roots(report), expected, diagnostic(id, report));
    assert.ok(
      report.every((group) => group.coverage.complete),
      diagnostic(id, report),
    );
    process.stdout.write(`${profile.id} authored ${id}@1.0.0: ${roots(report).join("/")}\n`);
  }
  const bounded = await createProbeBackend(workspace, join(base, "jobs"), images, {
    entryMs: 2500,
    batchMs: 10_000,
  });
  for (const [id] of protocolCases) {
    const report = await runFixture(id, id === "timeout" ? bounded : backend);
    const groups = report.filter((group) => group.entries.length);
    for (const group of groups) {
      if (id === "mixed")
        assert.deepEqual(
          group.observations.map((entry) => entry.outcome),
          ["pass", "fail", "pass"],
          diagnostic(id, report),
        );
      else if (id === "crash" || id === "timeout") {
        assert.deepEqual(
          group.observations.map((entry) => entry.index),
          [0, 2],
          diagnostic(id, report),
        );
        assert.equal(group.sessions.length, 2, diagnostic(id, report));
        assert.deepEqual(
          group.coverage,
          { planned: 3, observed: 2, interrupted: 1, untested: 0, complete: false },
          diagnostic(id, report),
        );
        assert.equal(
          group.interruptions[0].reason,
          id === "timeout" ? "entry_timeout" : "unexpected_process_exit",
          diagnostic(id, report),
        );
      } else if (id === "restart-limit") {
        assert.equal(group.sessions.length, 4, diagnostic(id, report));
        assert.equal(group.coverage.untested, 4, diagnostic(id, report));
      } else if (id === "fake-stdout" || id === "malformed") {
        assert.equal(
          group.sessions[0].stopReason,
          "harness_protocol_error",
          diagnostic(id, report),
        );
        assert.equal(group.coverage.complete, false, diagnostic(id, report));
      } else if (id === "bounded-error")
        assert.equal(group.observations[0].error.message.length, 2048, diagnostic(id, report));
      else if (id === "error-getter")
        assert.equal(group.observations[0].error.code, null, diagnostic(id, report));
      else assert.equal(group.coverage.complete, true, diagnostic(id, report));
      if (id === "work-cap") assert.equal(group.observations.length, 512, diagnostic(id, report));
    }
    process.stdout.write(`${profile.id} protocol ${id}: qualified\n`);
  }
  assert.equal((await inspectTree(workspace)).digest, originalTree.digest);
  for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
    await docker(["pull", "--platform=linux/amd64", image], 180_000);
  for (const [name, version] of liveCorpus) {
    const snapshot = await prepareArtifact(
      await new RegistryClient().resolve(name, version),
      join(base, "snapshots"),
    );
    try {
      const plan = planProbes(
        await readFile(join(snapshot.workspace, "node_modules", name, "package.json")),
        [profile],
      );
      const result = await executePlan(
        plan,
        images,
        await createProbeBackend(snapshot.workspace, join(base, "jobs"), images),
        AbortSignal.timeout(PROBE_LIMITS.scanMs),
      );
      assert.deepEqual(roots(result), ["pass", "pass"], diagnostic(`${name}@${version}`, result));
      assert.ok(
        result.every((group) => group.coverage.complete),
        diagnostic(name, result),
      );
      assert.equal((await inspectTree(snapshot.workspace)).digest, snapshot.tree.digest);
      process.stdout.write(`${profile.id} registry ${name}@${version}: qualified\n`);
    } finally {
      await snapshot.dispose();
    }
  }
  process.stdout.write(`${profile.id}: 50 package versions and 10 protocol cases qualified\n`);
  if (profile.id === "node_24_21_0") {
    const invoke = async (args) =>
      JSON.parse(
        await command(
          process.execPath,
          ["apps/cli/dist/bin.js", ...args, "--state-dir", cliState, "--json"],
          300_000,
        ),
      );
    const first = await invoke(["check", "is-number@7.0.0"]);
    assert.equal(first.images.length, 4);
    const file = join(cliState, "reports", `${first.id}.json`);
    const reused = await invoke(["reproduce", file]);
    assert.equal(reused.reproduction.method, "verified_reuse");
    assert.equal(reused.snapshot.generation, first.snapshot.generation);
    const rebuilt = await invoke(["reproduce", file, "--rebuild"]);
    assert.equal(rebuilt.reproduction.method, "rebuilt_from_lock");
    assert.notEqual(rebuilt.snapshot.generation, first.snapshot.generation);
    assert.equal(rebuilt.snapshot.lockDigest, first.snapshot.lockDigest);
    process.stdout.write(
      "CLI: four-runtime check, verified reuse and explicit lock rebuild qualified\n",
    );
  }
} finally {
  for (const id of await readdir(join(cliState, "snapshots")).catch(() => []))
    await (await WorkspaceVolume.reopen(join(cliState, "snapshots", id))).dispose();
  await volume.dispose();
  await rm(base, { recursive: true, force: true });
}

async function runFixture(id, backend) {
  const plan = planProbes(
    await readFile(join(workspace, "node_modules", `compatlab-fixture-${id}`, "package.json")),
    [profile],
  );
  if (id === "work-cap") assert.equal(plan.omissions.counts.coverage_limit, 88);
  return executePlan(plan, images, backend, AbortSignal.timeout(PROBE_LIMITS.scanMs));
}
function roots(groups) {
  return groups
    .filter((group) => group.group === "root")
    .map((group) =>
      group.entries.length === 0
        ? "not_applicable"
        : group.coverage.complete
          ? group.observations[0]?.outcome
          : group.sessions[0]?.stopReason,
    );
}
function diagnostic(id, groups) {
  return `${id}: ${JSON.stringify(groups)}`;
}
