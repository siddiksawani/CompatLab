import { randomUUID } from "node:crypto";
import { chown, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  artifactIntegrity,
  assertPackageName,
  isExactVersion,
  MAX_LOCK_BYTES,
  PreparationError,
  parseInstalledManifest,
  type ResolvedArtifact,
  registryTarballUrl,
  type ValidatedLock,
  validateLock,
} from "@compatlab/engine";
import { type CommandResult, docker, removeContainer, streamCommand } from "../command.js";
import { inspectDocker } from "../doctor.js";
import { inspectTree, readBoundedFile, type TreeInspection } from "./files.js";
import { createPreparationNetwork, type PreparationNetwork } from "./proxy.js";
import { WorkspaceVolume } from "./volume.js";

export const INSTALLER_IMAGE =
  "node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7";
export const PREPARATION_PROFILE = "npm_11_19_0_linux_amd64_v1";
export const NPM_FLAGS = [
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--registry=https://registry.npmjs.org",
  "--userconfig=/dev/null",
  "--globalconfig=/dev/null",
  "--cache=/state/cache",
  "--fetch-retries=0",
  "--fetch-timeout=30000",
  "--maxsockets=4",
  "--update-notifier=false",
  "--logs-max=0",
  "--progress=false",
] as const;

export type PreparedSnapshot = {
  id: string;
  generation: string;
  directory: string;
  workspace: string;
  artifact: ResolvedArtifact;
  profileRevision: typeof PREPARATION_PROFILE;
  installerImage: typeof INSTALLER_IMAGE;
  installerVersion: "11.19.0";
  platform: "linux_amd64";
  lock: ValidatedLock;
  tree: TreeInspection;
  installed: string[];
  omittedOptional: string[];
  logs: CommandResult[];
  dispose(): Promise<void>;
};

export async function prepareArtifact(
  artifact: ResolvedArtifact,
  stateDirectory: string,
  signal?: AbortSignal,
): Promise<PreparedSnapshot> {
  assertPackageName(artifact.name);
  if (!isExactVersion(artifact.version))
    throw new TypeError("Preparation requires an exact version.");
  artifactIntegrity(artifact.integrity);
  registryTarballUrl(artifact.tarballUrl);
  await assertPreparationHost();
  const id = randomUUID();
  const directory = join(resolve(stateDirectory), id);
  await mkdir(resolve(stateDirectory), { recursive: true, mode: 0o700 });
  const stateStat = await lstat(resolve(stateDirectory));
  if (!stateStat.isDirectory() || stateStat.uid !== 0 || (stateStat.mode & 0o022) !== 0)
    throw new PreparationError(
      "runner_unavailable",
      "Snapshot storage must be owned by root and not writable by other users.",
    );
  const deadline = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
  const volume = await WorkspaceVolume.create(directory);
  let network: PreparationNetwork | undefined;
  const logs: CommandResult[] = [];
  try {
    deadline.throwIfAborted();
    const workspace = join(volume.path, "workspace");
    const state = join(volume.path, "state");
    for (const path of [workspace, state]) {
      await mkdir(path);
      await chown(path, 65534, 65534);
    }
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "compatlab-consumer",
        version: "1.0.0",
        private: true,
        dependencies: { [artifact.name]: artifact.version },
      }),
      { mode: 0o644, flag: "wx" },
    );
    network = await createPreparationNetwork(id, directory);
    logs.push(await phase(["install", "--package-lock-only", ...NPM_FLAGS], "resolve"));
    const lockBytes = await readBoundedFile(join(workspace, "package-lock.json"), MAX_LOCK_BYTES);
    const lock = validateLock(lockBytes, artifact);
    logs.push(await phase(["ci", ...NPM_FLAGS], "install"));
    const finalBytes = await readBoundedFile(join(workspace, "package-lock.json"), MAX_LOCK_BYTES);
    if (!finalBytes.equals(lockBytes))
      throw new PreparationError(
        "artifact_integrity_mismatch",
        "npm changed the validated lock during installation.",
      );
    await network.dispose();
    network = undefined;
    deadline.throwIfAborted();
    const tree = await inspectTree(workspace, undefined, deadline);
    const directories = new Set(
      tree.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
    );
    const installed = lock.dependencies
      .filter((entry) => directories.has(entry.location))
      .map((entry) => entry.location);
    const missing = lock.dependencies.filter((entry) => !directories.has(entry.location));
    if (missing.some((entry) => !entry.optional))
      throw new PreparationError(
        "dependency_install_failed",
        "A required locked dependency was not installed.",
      );
    const installedManifest = parseInstalledManifest(
      await readBoundedFile(
        join(workspace, "node_modules", artifact.name, "package.json"),
        2 * 1024 ** 2,
      ),
    );
    if (installedManifest.name !== artifact.name || installedManifest.version !== artifact.version)
      throw new PreparationError(
        "package_manifest_invalid",
        "Installed root identity differs from the selected artifact.",
      );
    await rm(state, { recursive: true });
    deadline.throwIfAborted();
    await volume.seal();
    const generation = randomUUID();
    const snapshot: PreparedSnapshot = {
      id,
      generation,
      directory,
      workspace,
      artifact,
      profileRevision: PREPARATION_PROFILE,
      installerImage: INSTALLER_IMAGE,
      installerVersion: "11.19.0" as const,
      platform: "linux_amd64" as const,
      lock,
      tree,
      installed,
      omittedOptional: missing.map((entry) => entry.location),
      logs,
      dispose: () => volume.dispose(),
    };
    await writeFile(
      join(directory, "snapshot.json"),
      JSON.stringify({
        schemaVersion: 1,
        id,
        generation,
        artifact: {
          name: artifact.name,
          version: artifact.version,
          integrity: artifact.integrity,
          tarballUrl: artifact.tarballUrl,
        },
        profileRevision: PREPARATION_PROFILE,
        installerImage: INSTALLER_IMAGE,
        lockDigest: lock.digest,
        treeDigest: tree.digest,
        sealed: true,
      }),
      { mode: 0o600, flag: "wx" },
    );
    return snapshot;

    async function phase(args: string[], phaseName: string): Promise<CommandResult> {
      deadline.throwIfAborted();
      if (!network) throw new Error("Preparation has no network reservation.");
      const name = `compatlab-prep-${id}-${phaseName}`;
      const result = await runInstaller({
        name,
        workspace,
        state,
        network,
        args,
        signal: deadline,
      });
      if (result.termination !== "completed")
        throw new PreparationError(
          "preparation_limit_exceeded",
          `Preparation stopped: ${result.termination}.`,
        );
      if (result.exitCode !== 0) {
        const classification = /\bEINTEGRITY\b/.test(result.stderr)
          ? "artifact_integrity_mismatch"
          : /\b(?:ENOSPC|ENOMEM)\b/.test(result.stderr)
            ? "preparation_limit_exceeded"
            : "dependency_install_failed";
        throw new PreparationError(
          classification,
          `npm ${phaseName} failed: ${result.stderr.slice(-4096)}`,
        );
      }
      return result;
    }
  } catch (error) {
    if (network) await network.dispose();
    await volume.dispose();
    throw error;
  }
}

export async function runInstaller(options: {
  name: string;
  workspace: string;
  state: string;
  network: Pick<PreparationNetwork, "name" | "jobIp" | "proxyIp">;
  args: string[];
  signal: AbortSignal;
}): Promise<CommandResult> {
  const { name, workspace, state, network, args, signal } = options;
  const proxy = `http://${network.proxyIp}:3128`;
  try {
    return await streamCommand(
      "docker",
      [
        "run",
        "--name",
        name,
        "--label",
        "compatlab.managed=true",
        "--pull=never",
        "--runtime=runsc",
        "--network",
        network.name,
        "--ip",
        network.jobIp,
        "--dns=127.0.0.1",
        "--sysctl=net.ipv6.conf.all.disable_ipv6=1",
        "--read-only",
        "--user=65534:65534",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=2g",
        "--memory-swap=2g",
        "--cpus=1",
        "--pids-limit=128",
        "--ulimit=nproc=128:128",
        "--ulimit=core=0:0",
        "--log-driver=none",
        "--workdir=/workspace",
        "--mount",
        `type=bind,src=${workspace},dst=/workspace`,
        "--mount",
        `type=bind,src=${state},dst=/state`,
        "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m",
        "--env=HOME=/state/home",
        "--env=NODE_OPTIONS=",
        "--env=HTTP_PROXY=",
        "--env=http_proxy=",
        "--env=ALL_PROXY=",
        "--env=all_proxy=",
        "--env=FTP_PROXY=",
        "--env=ftp_proxy=",
        "--env=NO_PROXY=",
        "--env=no_proxy=",
        `--env=HTTPS_PROXY=${proxy}`,
        `--env=https_proxy=${proxy}`,
        "--entrypoint=npm",
        INSTALLER_IMAGE,
        ...args,
      ],
      signal,
    );
  } finally {
    await removeContainer(name);
  }
}

export async function assertPreparationHost(): Promise<void> {
  const info = await inspectDocker();
  const endpoint = await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  if (
    !info.prerequisitesAvailable ||
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    process.geteuid?.() !== 0 ||
    endpoint !== "unix:///var/run/docker.sock" ||
    (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== endpoint)
  )
    throw new PreparationError(
      "runner_unavailable",
      "Preparation requires root on the local Linux amd64 Docker/runsc host.",
    );
}
