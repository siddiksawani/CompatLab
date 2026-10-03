import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createWorkerFixtures } from "../fixtures/worker/create.mjs";
import { RegistryClient, runtimeArguments } from "../packages/engine/dist/index.js";
import { command, docker, removeContainer } from "../services/worker/dist/command.js";
import {
  buildRuntimeImages,
  collectSnapshots,
  createPreparationNetwork,
  createProbeBackend,
  ExecutionSupervisor,
  INSTALLER_IMAGE,
  inspectTree,
  PROXY_IMAGE,
  prepareArtifact,
  reuseSnapshot,
  runtimeContainerArguments,
  WorkspaceVolume,
} from "../services/worker/dist/index.js";
import { OutputVolume } from "../services/worker/dist/runtime/output.js";

const base = await mkdtemp(join(tmpdir(), "compatlab-worker-"));
const images = await buildRuntimeImages();
const volume = await WorkspaceVolume.create(join(base, randomUUID()), 64 * 1024 ** 2, 4096);
const workspace = join(volume.path, "workspace");
const jobs = join(base, "jobs");
const server = createServer((socket) => socket.end("host"));
await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
const port = server.address().port;
const secret = join(base, "host-secret");
await writeFile(secret, randomUUID(), { mode: 0o600 });
process.env.COMPATLAB_HOST_SECRET = "qualification-secret";
let siblingOutput;
const siblingName = `compatlab-runtime-${randomUUID()}`;
try {
  await mkdir(workspace);
  await createWorkerFixtures(workspace, secret, port);
  const addon = join(workspace, "node_modules/compatlab-hostile-forks/limit.node");
  await command("cc", [
    "-shared",
    "-fPIC",
    "-pthread",
    "-I",
    resolve(dirname(process.execPath), "../include/node"),
    "fixtures/worker/process-limit.c",
    "-o",
    addon,
  ]);
  await copyFile(addon, join(workspace, "node_modules/compatlab-hostile-threads/limit.node"));
  const before = await inspectTree(workspace);
  await volume.seal();
  siblingOutput = await OutputVolume.create(join(base, "sibling-output"));
  const siblingArgs = runtimeContainerArguments({
    name: siblingName,
    image: images[0],
    workspace,
    harness: resolve("fixtures/worker"),
    output: siblingOutput.path,
  });
  siblingArgs.splice(1, 0, "--detach");
  await docker([...siblingArgs, ...runtimeArguments("node", "/workspace/.compatlab/sibling.mjs")]);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await readFile(join(siblingOutput.path, "ready"), "utf8").catch(() => false)) break;
    await delay(100);
  }
  assert.equal(await readFile(join(siblingOutput.path, "ready"), "utf8"), "ready");
  const backend = await createProbeBackend(workspace, jobs, images);
  const bounded = await createProbeBackend(workspace, jobs, images, {
    entryMs: 2500,
    batchMs: 10_000,
  });
  for (const image of images) {
    for (const [id, expected] of [
      ["filesystem", "completed"],
      ["network", "completed"],
      ["temp", "completed"],
      ["output", "output_limit_exceeded"],
      ["inodes", "output_limit_exceeded"],
      ["memory", "memory_limit_exceeded"],
      ["cpu", "entry_timeout"],
      ["flood", "output_limit_exceeded"],
      ["forks", "completed"],
      ["threads", "completed"],
      ["descendants", "completed"],
    ]) {
      const input = {
        schemaVersion: 2,
        probeId: randomUUID(),
        mode: id === "network" ? "esm" : "commonjs",
        group: "root",
        entries: [`compatlab-hostile-${id}`],
        startIndex: 0,
      };
      const result = await (id === "cpu" ? bounded : backend).run(
        input,
        image,
        AbortSignal.timeout(60_000),
      );
      assert.equal(
        result.stopReason,
        expected,
        JSON.stringify({ id, profile: image.profileId, result }),
      );
      if (expected === "completed")
        assert.equal(result.checkpoint.observations[0].outcome, "pass", JSON.stringify(result));
      assert.deepEqual(await readdir(jobs), []);
      process.stdout.write(`${image.profileId} containment ${id}: qualified\n`);
    }
    for (const [reason, signal] of [
      ["cancelled", new AbortController()],
      ["scan_deadline", null],
    ]) {
      const timeout = reason === "cancelled" ? signal.signal : AbortSignal.timeout(1500);
      const input = {
        schemaVersion: 2,
        probeId: randomUUID(),
        mode: "commonjs",
        group: "root",
        entries: ["compatlab-hostile-cpu"],
        startIndex: 0,
      };
      let cgroup;
      const operation = backend.run(input, image, timeout);
      try {
        if (signal) {
          cgroup = await inspectRunningCgroup();
          signal.abort();
        }
        const result = await operation;
        assert.equal(result.stopReason, reason, JSON.stringify(result));
        if (cgroup)
          assert.equal(
            await readFile(join(cgroup, "cgroup.procs"), "utf8").catch((error) => {
              if (error.code === "ENOENT") return "";
              throw error;
            }),
            "",
            "Cancelled sandbox retained host processes.",
          );
      } finally {
        signal?.abort();
        await operation;
      }
      assert.deepEqual(await readdir(jobs), []);
    }
  }
  assert.equal((await inspectTree(workspace)).digest, before.digest);
  await removeContainer(siblingName);
  await siblingOutput.dispose();
  siblingOutput = undefined;
  assert.equal(
    await docker([
      "ps",
      "--all",
      "--filter",
      "label=compatlab.managed=true",
      "--format",
      "{{.Names}}",
    ]),
    "",
  );
  for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
    await docker(["pull", "--platform=linux/amd64", image], 180_000);
  await qualifyPreparationNetwork();
  await qualifyRecovery();
  await qualifyReuse();
  process.stdout.write(
    "Worker lifecycle: network, capacity ownership, crash recovery and sealed reuse qualified\n",
  );
} finally {
  await removeContainer(siblingName);
  if (siblingOutput) await siblingOutput.dispose();
  server.close();
  await volume.dispose();
  await rm(base, { recursive: true, force: true });
}

async function inspectRunningCgroup() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const names = (
      await docker(["ps", "--filter", "name=compatlab-runtime-", "--format", "{{.Names}}"])
    ).split("\n");
    const name = names.find((name) => name && name !== siblingName);
    if (name) {
      const pid = await docker(["inspect", "--format", "{{.State.Pid}}", name]);
      assert.match(pid, /^[1-9]\d*$/);
      const record = await readFile(`/proc/${pid}/cgroup`, "utf8");
      const path = /^0::(\/[^\n]*)$/m.exec(record)?.[1];
      assert.ok(path && !path.split("/").includes(".."), "A cgroup v2 sandbox is required.");
      const cgroup = join("/sys/fs/cgroup", path);
      const [quota, period] = (await readFile(join(cgroup, "cpu.max"), "utf8"))
        .trim()
        .split(" ")
        .map(Number);
      assert.ok(quota > 0 && quota / period <= 1, "CPU quota must be at most one core.");
      assert.equal((await readFile(join(cgroup, "memory.max"), "utf8")).trim(), "1073741824");
      assert.equal((await readFile(join(cgroup, "pids.max"), "utf8")).trim(), "512");
      return cgroup;
    }
    await delay(100);
  }
  throw new Error("The CPU fixture did not enter a measurable sandbox cgroup.");
}

async function qualifyPreparationNetwork() {
  const id = randomUUID(),
    directory = join(base, id);
  await mkdir(directory);
  const network = await createPreparationNetwork(id, directory);
  const name = `compatlab-prep-${id}-test`;
  try {
    const source = `const assert=require('node:assert/strict');const net=require('node:net');
      function request(host,port,data) { return new Promise((resolve,reject)=>{const socket=net.createConnection({host,port});let result='';socket.setTimeout(700);socket.on('connect',()=>{if(data)socket.write(data);else {socket.destroy();reject(new Error('bypass connected'));}});socket.on('data',bytes=>{result+=bytes; if(result.includes('\\r\\n')) {socket.destroy();resolve(result);}});socket.on('error',()=>resolve('blocked'));socket.on('timeout',()=>{socket.destroy();resolve('blocked');});});}
      (async()=>{for(const [host,port] of [['1.1.1.1',443],['169.254.169.254',80],['${network.proxyIp}',80],['172.17.0.1',${port}],['fd00:ec2::254',80]])assert.equal(await request(host,port),'blocked');
      for(const target of ['example.com:443','169.254.169.254:443','registry.npmjs.org:444','registry.npmjs.org.evil.invalid:443'])assert.match(await request('${network.proxyIp}',3128,'CONNECT '+target+' HTTP/1.1\\r\\nHost: '+target+'\\r\\n\\r\\n'),/403/);})().catch(error=>{console.error(error);process.exitCode=1;});`;
    await docker(
      [
        "run",
        "--name",
        name,
        "--label=compatlab.managed=true",
        "--runtime=runsc",
        "--network",
        network.name,
        "--ip",
        network.jobIp,
        "--dns=127.0.0.1",
        "--sysctl=net.ipv6.conf.all.disable_ipv6=1",
        "--read-only",
        "--user=65534",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=512m",
        "--cpus=1",
        "--pids-limit=128",
        "--entrypoint=node",
        INSTALLER_IMAGE,
        "-e",
        source,
      ],
      30_000,
    );
  } finally {
    await removeContainer(name);
    await network.dispose();
    await rm(directory, { recursive: true });
  }
}
async function qualifyRecovery() {
  const state = join(base, "recovery");
  const current = await ExecutionSupervisor.open(state);
  await assert.rejects(() => ExecutionSupervisor.open(state), /owns this host/);
  await current.close();
  const imageFile = join(base, "images.json");
  await writeFile(imageFile, JSON.stringify(images));
  const child = spawn(
    process.execPath,
    ["fixtures/worker/crash-owner.mjs", state, workspace, imageFile],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (bytes) => {
    errors = (errors + bytes).slice(-8192);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(errors || "Crash fixture did not start."));
    }, 30_000);
    child.stdout.on("data", (bytes) => {
      if (bytes.toString().includes("ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Crash fixture exited ${code}: ${errors}`));
    });
  });
  assert.notEqual(
    await docker(["ps", "--filter", "label=compatlab.managed=true", "--format", "{{.Names}}"]),
    "",
  );
  const exited = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGKILL");
  await exited;
  await delay(200);
  const recovered = await ExecutionSupervisor.open(state);
  try {
    assert.equal(
      await docker([
        "ps",
        "--all",
        "--filter",
        "label=compatlab.managed=true",
        "--format",
        "{{.Names}}",
      ]),
      "",
    );
    assert.equal(
      await docker([
        "network",
        "ls",
        "--filter",
        "label=compatlab.managed=true",
        "--format",
        "{{.Name}}",
      ]),
      "",
    );
    assert.deepEqual(await readdir(join(state, "snapshots")), []);
    assert.deepEqual(await readdir(join(state, "jobs")), []);
    assert.doesNotMatch(await command("iptables", ["-S"]), /CL[a-f0-9]{20}/);
  } finally {
    await recovered.close();
  }
}
async function qualifyReuse() {
  const state = join(base, "reuse");
  await mkdir(state, { mode: 0o700 });
  const artifact = await new RegistryClient().resolve("is-number", "7.0.0");
  const snapshot = await prepareArtifact(artifact, join(state, "snapshots"));
  const reopened = await reuseSnapshot(snapshot.id, join(state, "snapshots"), artifact);
  assert.equal(reopened.workspace, snapshot.workspace);
  assert.equal(reopened.generation, snapshot.generation);
  await collectSnapshots(state, new Set([snapshot.id]));
  assert.equal((await inspectTree(snapshot.workspace)).digest, snapshot.tree.digest);
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await utimes(join(snapshot.directory, "snapshot.json"), old, old);
  await collectSnapshots(state);
  await assert.rejects(() => reuseSnapshot(snapshot.id, join(state, "snapshots"), artifact));
  assert.deepEqual(await readdir(join(state, "snapshots")), []);
  const owner = await ExecutionSupervisor.open(state);
  const retained = await owner.withScan((scanId) =>
    owner.prepare(artifact, scanId, new AbortController().signal),
  );
  await owner.close();
  await mkdir(join(state, "snapshots", "unexpected"), { mode: 0o700 });
  await assert.rejects(
    () => ExecutionSupervisor.open(join(base, "changed-state")),
    /Unrecognized snapshot directory/,
  );
  assert.equal(
    JSON.parse(await readFile("/run/compatlab-worker.lock", "utf8")).stateDirectory,
    state,
    "Failed retirement must keep the previous state root recoverable.",
  );
  await rm(join(state, "snapshots", "unexpected"), { recursive: true });
  const changed = await ExecutionSupervisor.open(join(base, "changed-state"));
  try {
    assert.deepEqual(
      await readdir(join(state, "snapshots")),
      [],
      "Switching state roots must retire the old snapshot cache.",
    );
    await assert.rejects(() => reuseSnapshot(retained.id, join(state, "snapshots"), artifact));
  } finally {
    await changed.close();
  }
}
