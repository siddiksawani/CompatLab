import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chown,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RegistryClient, validateLock } from "../packages/engine/dist/index.js";
import { command, docker } from "../services/worker/dist/command.js";
import {
  assertPreparationHost,
  createPreparationNetwork,
  INSTALLER_IMAGE,
  inspectTree,
  NPM_FLAGS,
  PROXY_IMAGE,
  prepareArtifact,
  readBoundedFile,
  reuseSnapshot,
  runInstaller,
  WorkspaceVolume,
} from "../services/worker/dist/index.js";

await assertPreparationHost();
for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
  await docker(["pull", "--platform=linux/amd64", image], 180_000);
assert.equal(
  await docker([
    "run",
    "--rm",
    "--runtime=runsc",
    "--network=none",
    INSTALLER_IMAGE,
    "npm",
    "--version",
  ]),
  "11.19.0",
);
const base = await mkdtemp(join(tmpdir(), "compatlab-preparation-"));
const fixtureDirectory = join(base, "fixtures");
await command("python3", ["fixtures/preparation/build.py", fixtureDirectory], 30_000);
const fixtures = JSON.parse(await readFile(join(fixtureDirectory, "fixtures.json"), "utf8"));
let live;
try {
  const artifact = await new RegistryClient().resolve("is-number", "7.0.0");
  const cancelledPath = join(base, "cancelled");
  await assert.rejects(() => prepareArtifact(artifact, cancelledPath, AbortSignal.abort()));
  assert.equal(await exists(cancelledPath), false);
  live = await prepareArtifact(artifact, base);
  const reopened = await reuseSnapshot(live.id, base, artifact);
  assert.equal(reopened.workspace, live.workspace);
  assert.equal(reopened.generation, live.generation);
  assert.equal(reopened.tree.digest, live.tree.digest);
  const metadataPath = join(live.directory, "snapshot.json");
  const metadataBytes = await readFile(metadataPath);
  await writeFile(metadataPath, "{truncated");
  await assert.rejects(() => reuseSnapshot(live.id, base, artifact), {
    classification: "artifact_integrity_mismatch",
  });
  await writeFile(metadataPath, metadataBytes);
  for (const policy of ["ro,dev,nosuid,exec", "ro,nodev,suid,exec", "ro,nodev,nosuid,noexec"]) {
    await command("mount", ["-o", `remount,${policy}`, join(live.directory, "volume")]);
    await assert.rejects(() => reuseSnapshot(live.id, base, artifact), {
      classification: "archive_rejected",
    });
  }
  await command("mount", ["-o", "remount,ro,nodev,nosuid,exec", join(live.directory, "volume")]);
  const launchFailure = await runInstaller({
    name: `compatlab-missing-network-${randomUUID()}`,
    workspace: live.workspace,
    state: live.workspace,
    network: {
      name: `compatlab-absent-${randomUUID()}`,
      jobIp: "192.0.2.3",
      proxyIp: "192.0.2.2",
      quotaExceeded: async () => false,
    },
    args: ["--version"],
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(launchFailure.failure, "sandbox_start_failed");
  process.stdout.write(
    "reuse: corrupt metadata and altered mount policies rejected; launch failures remain infrastructure errors\n",
  );
  const probe =
    "const fs=require('node:fs');try{fs.writeFileSync('/workspace/node_modules/is-number/index.js','changed');process.exit(1)}catch(e){if(e.code!=='EROFS')throw e}console.log('sealed')";
  for (let index = 0; index < 2; index++)
    assert.equal(
      await docker([
        "run",
        "--rm",
        "--runtime=runsc",
        "--network=none",
        "--read-only",
        "--user=65534:65534",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=1g",
        "--memory-swap=1g",
        "--pids-limit=128",
        "--mount",
        `type=bind,src=${live.workspace},dst=/workspace,readonly`,
        INSTALLER_IMAGE,
        "node",
        "-e",
        probe,
      ]),
      "sealed",
    );
  process.stdout.write(
    "live registry preparation: scripts disabled, frozen lock, verified same sealed snapshot\n",
  );
  await live.dispose();
  live = undefined;

  for (const scenario of [
    "root",
    "traversal",
    "links",
    "compression",
    "expanded",
    "inodes",
    "integrity",
    "quota",
    "memory",
  ]) {
    const id = randomUUID();
    const volume = await WorkspaceVolume.create(
      join(base, id),
      64 * 1024 ** 2,
      scenario === "inodes" ? 1024 : 8192,
    );
    let network;
    try {
      const workspace = join(volume.path, "workspace");
      const state = join(volume.path, "state");
      for (const path of [workspace, state]) {
        await mkdir(path);
        await chown(path, 65534, 65534);
      }
      const root =
        scenario === "quota" || scenario === "memory"
          ? artifact
          : scenario === "integrity"
            ? { ...artifact, integrity: `sha512-${Buffer.alloc(64).toString("base64")}` }
            : fixtures[scenario];
      const manifest = {
        name: "compatlab-consumer",
        version: "1.0.0",
        private: true,
        dependencies: { [root.name]: root.version },
      };
      await writeFile(join(workspace, "package.json"), JSON.stringify(manifest));
      const packageEntry = (pkg) => ({
        version: pkg.version,
        hasInstallScript: Boolean(pkg.manifest?.scripts),
        resolved: pkg.tarballUrl,
        integrity: pkg.integrity,
        ...(pkg.manifest ?? {}),
      });
      const lock = {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: { "": manifest, [`node_modules/${root.name}`]: packageEntry(root) },
      };
      if (scenario === "root") {
        lock.packages[`node_modules/${fixtures.dep.name}`] = packageEntry(fixtures.dep);
        lock.packages["node_modules/compatlab-fixture-alias"] = packageEntry(fixtures.dep);
        lock.packages[`node_modules/${fixtures.optional.name}`] = {
          ...packageEntry(fixtures.optional),
          optional: true,
        };
        lock.packages[`node_modules/${root.name}/node_modules/compatlab-fixture-bundled`] = {
          version: "1.0.0",
          inBundle: true,
          hasInstallScript: true,
        };
      }
      const lockBytes = Buffer.from(JSON.stringify(lock));
      validateLock(lockBytes, root);
      await writeFile(join(workspace, "package-lock.json"), lockBytes);
      if (!["integrity", "quota", "memory"].includes(scenario)) {
        const archives = scenario === "root" ? [root, fixtures.dep, fixtures.optional] : [root];
        try {
          await docker(
            [
              "run",
              "--rm",
              "--runtime=runsc",
              "--network=none",
              "--read-only",
              "--user=65534:65534",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              "--memory=2g",
              "--memory-swap=2g",
              "--cpus=1",
              "--pids-limit=128",
              "--workdir=/workspace",
              "--mount",
              `type=bind,src=${workspace},dst=/workspace`,
              "--mount",
              `type=bind,src=${state},dst=/state`,
              "--mount",
              `type=bind,src=${fixtureDirectory},dst=/fixtures,readonly`,
              "--tmpfs=/tmp:size=64m",
              "--env=HOME=/state/home",
              INSTALLER_IMAGE,
              "npm",
              "cache",
              "add",
              ...archives.map((entry) => `/fixtures/${basename(entry.file)}`),
              ...NPM_FLAGS,
            ],
            30_000,
          );
        } catch (error) {
          if (scenario !== "compression") throw error;
          assert.match(error.stderr, /TAR_ABORT/);
          assert.match(error.stderr, /max decompression ratio exceeded/);
          process.stdout.write("compression: npm rejected the pathological archive\n");
          continue;
        }
        assert.notEqual(scenario, "compression", "The decompression-ratio guard did not fire.");
      }
      network = await createPreparationNetwork(
        id,
        volume.directory,
        scenario === "quota" ? 1024 : undefined,
      );
      if (scenario === "root") {
        const externalIp = await docker([
          "inspect",
          `compatlab-prep-${id}-proxy`,
          "--format",
          '{{(index .NetworkSettings.Networks "bridge").IPAddress}}',
        ]);
        await assert.rejects(() => proxyConnection(externalIp));
        const denied = await proxyConnection(
          network.proxyIp,
          "CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\n",
        );
        assert.match(denied, /^HTTP\/1\.1 403/);
        process.stdout.write("proxy: no listener on shared bridge; non-job sources denied\n");
      }
      const result = await runInstaller({
        name: `compatlab-fixture-${id}`,
        workspace,
        state,
        network,
        args:
          scenario === "memory"
            ? [
                "exec",
                "--offline",
                "--call=node -e 'const buffers=[];setInterval(()=>buffers.push(Buffer.alloc(64*1024*1024,1)),25)'",
                ...NPM_FLAGS,
              ]
            : ["ci", ...NPM_FLAGS, ...(scenario === "quota" ? ["--fetch-timeout=2000"] : [])],
        signal: AbortSignal.timeout(60_000),
      });
      assert.equal(await exists(join(volume.path, "escape")), false);
      assert.equal(await exists(join(base, "escape")), false);
      assert.equal(await exists("/tmp/compatlab-archive-escape"), false);
      if (scenario === "quota" || scenario === "memory") {
        assert.equal(result.failure, "preparation_limit_exceeded", JSON.stringify(result));
        assert.equal(scenario === "quota" ? result.downloadLimitExceeded : result.oomKilled, true);
      } else if (scenario === "integrity") {
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.failure, "artifact_integrity_mismatch");
        assert.match(result.stderrTail, /EINTEGRITY/);
      } else if (["expanded", "inodes"].includes(scenario)) {
        assert.equal(result.failure, "preparation_limit_exceeded", JSON.stringify(result));
        assert.match(`${result.stderr}\n${result.stderrTail}`, /ENOSPC/);
      } else if (scenario === "traversal") {
        assert.equal(result.failure, "archive_rejected");
        assert.match(result.stderrTail, /TAR_ENTRY_ERROR path contains/);
      } else {
        assert.equal(result.exitCode, 0, JSON.stringify(result));
        assert.equal(result.failure, undefined, JSON.stringify(result));
        let tree;
        try {
          tree = await inspectTree(workspace);
        } catch (error) {
          assert.equal(scenario, "links");
          assert.equal(error.classification, "archive_rejected");
          process.stdout.write("links: unsafe retained tree rejected before sealing\n");
          continue;
        }
        for (const name of ["root", "dependency", "bundled"])
          assert.equal(await exists(join(workspace, `${name}-script-ran`)), false);
        if (scenario === "root") {
          assert.ok(
            tree.entries.some((entry) => entry.path.includes("compatlab-fixture-alias/index.js")),
          );
          assert.ok(
            tree.entries.some((entry) => entry.path.includes("compatlab-fixture-bundled/index.js")),
          );
          assert.equal(
            await exists(join(workspace, "node_modules", fixtures.optional.name)),
            false,
          );
        }
        assert.deepEqual(
          await readBoundedFile(join(workspace, "package-lock.json"), 16 * 1024 ** 2),
          lockBytes,
        );
      }
      process.stdout.write(`${scenario}: preparation boundary passed\n`);
    } finally {
      if (network) await network.dispose();
      await volume.dispose();
    }
  }
  const limited = await WorkspaceVolume.create(join(base, randomUUID()), 64 * 1024 ** 2, 1024);
  try {
    const remaining = (await statfs(limited.path)).ffree;
    for (let index = 0; index < remaining - 1; index++)
      await writeFile(join(limited.path, `fill-${index}`), "");
    const partial = join(limited.path, "partial");
    await assert.rejects(() => WorkspaceVolume.create(partial, 64 * 1024 ** 2, 1024), {
      code: "ENOSPC",
    });
    assert.equal(await exists(partial), false);
    process.stdout.write("partial creation: failed backing-file setup cleaned up\n");
  } finally {
    await limited.dispose();
  }
} finally {
  if (live) await live.dispose();
  await rm(fixtureDirectory, { recursive: true, force: true });
  await rmdir(base);
}
async function exists(path) {
  return stat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}
function proxyConnection(host, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: 3128 });
    socket.setTimeout(1000);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Connection timed out."));
    });
    socket.once("connect", () => {
      if (request) socket.write(request);
      else {
        socket.destroy();
        resolve("connected");
      }
    });
    socket.once("data", (bytes) => {
      socket.destroy();
      resolve(bytes.toString("utf8"));
    });
  });
}
