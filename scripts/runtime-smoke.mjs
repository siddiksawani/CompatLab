import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRuntimeFixtures } from "../fixtures/runtime/create.mjs";
import {
  manifestObservations,
  planProbes,
  RegistryClient,
  RUNTIME_PROFILES,
  runtimeArguments,
  runtimeProfile,
} from "../packages/engine/dist/index.js";
import {
  command,
  docker,
  removeContainer,
  streamCommand,
} from "../services/worker/dist/command.js";
import {
  buildRuntimeImages,
  INSTALLER_IMAGE,
  inspectTree,
  PROXY_IMAGE,
  prepareArtifact,
  readBoundedFile,
  runtimeContainerArguments,
  verifyRuntimeImages,
  WorkspaceVolume,
} from "../services/worker/dist/index.js";

const images = await buildRuntimeImages();
await verifyRuntimeImages(images);
await assert.rejects(verifyRuntimeImages([{ ...images[0], imageId: images[1].imageId }]), /labels/);
const base = await mkdtemp(join(tmpdir(), "compatlab-runtime-"));
const volume = await WorkspaceVolume.create(join(base, randomUUID()), 64 * 1024 ** 2, 8192);
let live;
try {
  const workspace = join(volume.path, "workspace");
  await mkdir(workspace);
  await chmod(workspace, 0o777);
  await createRuntimeFixtures(workspace);
  const addon = join(workspace, "node_modules/compatlab-fixture-native/addon.node");
  await command("cc", [
    "-shared",
    "-fPIC",
    "-I",
    resolve(dirname(process.execPath), "../include/node"),
    "fixtures/runtime/addon.c",
    "-o",
    addon,
  ]);
  const before = await inspectTree(workspace);
  await volume.seal();
  const failures = [];
  for (const image of images) {
    try {
      const profile = runtimeProfile(image.profileId);
      const version = await docker([
        "run",
        "--rm",
        "--runtime=runsc",
        "--network=none",
        "--read-only",
        "--entrypoint",
        profile.binary,
        image.imageId,
        "--version",
      ]);
      assert.match(
        version,
        new RegExp(`(?:^|\\s|v)${profile.version.replaceAll(".", "\\.")}(?:$|\\s)`),
      );
      const evidence = await execute(image, workspace, "qualify");
      assert.equal(evidence.kind, image.kind);
      assert.equal(evidence.observations.length, 18);
      assert.equal(
        evidence.observations.filter((observation) => observation.outcome === "fail").length,
        3,
      );
      process.stdout.write(
        `${profile.id}: ESM, CJS, TLA, export order, native loading, prerequisites, offline caches qualified\n`,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Runtime qualification failed.");
  assert.equal((await inspectTree(workspace)).digest, before.digest);
  const nativeManifest = await readFile(
    join(workspace, "node_modules/compatlab-fixture-native/package.json"),
  );
  assert.equal(
    manifestObservations(
      nativeManifest,
      before.entries.map((entry) => entry.path),
    ).native.count,
    1,
  );
  assert.equal(planProbes(nativeManifest, RUNTIME_PROFILES).runtimes.length, images.length);
  for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
    await docker(["pull", "--platform=linux/amd64", image], 180_000);
  live = await prepareArtifact(await new RegistryClient().resolve("is-number", "7.0.0"), base);
  for (const image of images)
    assert.equal((await execute(image, live.workspace, "live")).loaded, true);
  assert.equal((await inspectTree(live.workspace)).digest, live.tree.digest);
  assert.equal(
    planProbes(
      await readFile(join(live.workspace, "node_modules/is-number/package.json")),
      RUNTIME_PROFILES,
    ).runtimes.every((runtime) => runtime.root.esm.applicable && runtime.root.commonjs.applicable),
    true,
  );
  process.stdout.write(
    "is-number@7.0.0: all candidate runtimes loaded the same sealed snapshot offline\n",
  );
} finally {
  if (live) await live.dispose();
  await volume.dispose();
  await rmdir(base);
}

async function execute(image, workspace, script) {
  const output = join(base, `output-${randomUUID()}`);
  await mkdir(output, { mode: 0o777 });
  await chmod(output, 0o777);
  const name = `compatlab-runtime-${randomUUID()}`;
  try {
    const result = await streamCommand(
      "docker",
      [
        ...runtimeContainerArguments({
          name,
          image,
          workspace,
          harness: resolve("fixtures/runtime"),
          output,
        }),
        ...runtimeArguments(image.kind, `/workspace/.compatlab/${script}.mjs`),
        image.kind,
      ],
      AbortSignal.timeout(30_000),
    );
    assert.equal(result.termination, "completed", JSON.stringify(result));
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    return JSON.parse(await readBoundedFile(join(output, "result.json"), 64 * 1024));
  } finally {
    await removeContainer(name);
    await rm(output, { recursive: true, force: true });
  }
}
