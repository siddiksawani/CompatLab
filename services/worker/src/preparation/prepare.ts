import { createHash, randomUUID } from "node:crypto";
import { chmod, chown, lstat, mkdir, rm, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CiArtifact,
  ciArtifactSchema,
  PREPARATION_INSTALLER_IMAGE,
  PREPARATION_PROFILE_REVISION,
} from "@compatlab/contracts";
import {
  artifactIntegrity,
  assertPackageName,
  CI_FILE_SPEC,
  type ExecutionArtifact,
  isExactVersion,
  MAX_LOCK_BYTES,
  type PreparationClassification,
  PreparationError,
  parseInstalledManifest,
  type ResolvedArtifact,
  registryTarballUrl,
  type ValidatedLock,
  validateLock,
} from "@compatlab/engine";
import { type CommandResult, command, docker, removeContainer, streamCommand } from "../command.js";
import { inspectDocker } from "../doctor.js";
import { inspectTree, readBoundedFile, type TreeInspection } from "./files.js";
import { installerFailure, NpmOutput } from "./npm-output.js";
import { createPreparationNetwork, type PreparationNetwork } from "./proxy.js";
import { WorkspaceVolume } from "./volume.js";

export const INSTALLER_IMAGE = PREPARATION_INSTALLER_IMAGE;
export const PREPARATION_PROFILE = PREPARATION_PROFILE_REVISION;
export const NPM_FLAGS = [
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--registry=https://registry.npmjs.org",
  "--userconfig=/dev/null",
  "--globalconfig=/etc/compatlab-global.npmrc",
  "--cache=/state/cache",
  "--fetch-retries=0",
  "--fetch-timeout=30000",
  "--maxsockets=4",
  "--update-notifier=false",
  "--logs-max=0",
  "--progress=false",
] as const;

export type PreparedSnapshot<Artifact extends ExecutionArtifact = ResolvedArtifact> = {
  id: string;
  generation: string;
  directory: string;
  workspace: string;
  artifact: Artifact;
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
  retainedLock?: Uint8Array,
): Promise<PreparedSnapshot> {
  return prepareInput(artifact, stateDirectory, signal, retainedLock);
}
export async function prepareCiArtifact(
  artifact: CiArtifact,
  archive: string,
  stateDirectory: string,
  signal?: AbortSignal,
): Promise<PreparedSnapshot<CiArtifact>> {
  ciArtifactSchema.parse(artifact);
  const bytes = await readBoundedFile(archive, 32 * 1024 ** 2);
  if (
    bytes.length !== artifact.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== artifact.sha256 ||
    `sha512-${createHash("sha512").update(bytes).digest("base64")}` !== artifact.integrity
  )
    throw new TypeError("CI archive identity changed.");
  return prepareInput(artifact, stateDirectory, signal, undefined, archive);
}
async function prepareInput<Artifact extends ExecutionArtifact>(
  artifact: Artifact,
  stateDirectory: string,
  signal?: AbortSignal,
  retainedLock?: Uint8Array,
  archive?: string,
): Promise<PreparedSnapshot<Artifact>> {
  const ci = "kind" in artifact;
  signal?.throwIfAborted();
  assertPackageName(artifact.name);
  if (!isExactVersion(artifact.version))
    throw new TypeError("Preparation requires an exact version.");
  artifactIntegrity(artifact.integrity);
  if (!ci) registryTarballUrl(artifact.tarballUrl);
  if (retainedLock) validateLock(retainedLock, artifact);
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
  deadline.throwIfAborted();
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
      await chmod(path, 0o755);
    }
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "compatlab-consumer",
        version: "1.0.0",
        private: true,
        dependencies: { [artifact.name]: ci ? CI_FILE_SPEC : artifact.version },
      }),
      { mode: 0o644, flag: "wx" },
    );
    await chmod(join(workspace, "package.json"), 0o644);
    network = await createPreparationNetwork(id, directory);
    if (retainedLock) {
      await writeFile(join(workspace, "package-lock.json"), retainedLock, {
        mode: 0o644,
        flag: "wx",
      });
      await chmod(join(workspace, "package-lock.json"), 0o644);
    } else logs.push(await phase(["install", "--package-lock-only", ...NPM_FLAGS], "resolve"));
    const lockBytes = await readBoundedFile(join(workspace, "package-lock.json"), MAX_LOCK_BYTES);
    const lock = validateLock(lockBytes, artifact);
    logs.push(await phase(["ci", ...NPM_FLAGS], "install"));
    const finalBytes = await readBoundedFile(join(workspace, "package-lock.json"), MAX_LOCK_BYTES);
    if (!finalBytes.equals(lockBytes))
      throw new PreparationError(
        "artifact_integrity_mismatch",
        "npm changed the validated lock during installation.",
      );
    await mkdir(join(workspace, ".compatlab"), { mode: 0o755 });
    await chmod(join(workspace, ".compatlab"), 0o755);
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
      artifact,
    );
    if (ci && installedManifest.private === true)
      throw new PreparationError(
        "package_manifest_invalid",
        "Private CI packages are not supported.",
      );
    await rm(state, { recursive: true });
    deadline.throwIfAborted();
    await volume.seal();
    const generation = randomUUID();
    const snapshot: PreparedSnapshot<Artifact> = {
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
        artifact: ci
          ? artifact
          : {
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
        ...(archive ? { archive } : {}),
      });
      if (result.termination !== "completed")
        throw new PreparationError(
          "preparation_limit_exceeded",
          `Preparation stopped: ${result.termination}.`,
        );
      if (result.failure)
        throw new PreparationError(
          result.failure,
          `npm ${phaseName} failed: ${result.stderrTail.slice(-4096)}`,
        );
      return result;
    }
  } catch (error) {
    const failure =
      error instanceof PreparationError && network
        ? new PreparationError(
            error.classification,
            error.message,
            await network.diagnostics().catch(() => "Proxy diagnostics unavailable."),
          )
        : error;
    if (network) await network.dispose();
    await volume.dispose();
    throw failure;
  }
}

export async function runInstaller(options: {
  name: string;
  archive?: string;
  workspace: string;
  state: string;
  network: Pick<PreparationNetwork, "name" | "jobIp" | "proxyIp" | "quotaExceeded">;
  args: string[];
  signal: AbortSignal;
}): Promise<
  CommandResult & {
    failure?: PreparationClassification;
    oomKilled: boolean;
    downloadLimitExceeded: boolean;
  }
> {
  const { name, workspace, state, network, args, signal } = options;
  const proxy = `http://${network.proxyIp}:3128`;
  const output = new NpmOutput();
  let result: CommandResult;
  let oomKilled = false;
  let sandboxStartFailed = true;
  try {
    result = await streamCommand(
      "docker",
      [
        "create",
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
        "--pids-limit=512",
        "--ulimit=nproc=128:128",
        "--ulimit=core=0:0",
        "--log-driver=none",
        "--workdir=/workspace",
        "--mount",
        `type=bind,src=${workspace},dst=/workspace`,
        "--mount",
        `type=bind,src=${state},dst=/state`,
        ...(options.archive
          ? ["--mount", `type=bind,src=${options.archive},dst=/input/artifact.tgz,readonly`]
          : []),
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
    if (result.exitCode === 0 && result.termination === "completed") {
      result = await streamCommand("docker", ["start", "--attach", name], signal, (bytes) =>
        output.write(bytes),
      );
      const observed = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", name]));
      if (typeof observed.OOMKilled !== "boolean" || typeof observed.StartedAt !== "string")
        throw new Error("Container state evidence is unavailable.");
      oomKilled = observed.OOMKilled;
      sandboxStartFailed = Boolean(observed.Error) || observed.StartedAt.startsWith("0001-");
    }
  } finally {
    await removeContainer(name);
  }
  output.finish();
  const filesystem = await statfs(workspace);
  const downloadLimitExceeded = await network.quotaExceeded();
  const failure = installerFailure(result.exitCode, output, {
    bytes: filesystem.bavail * filesystem.bsize,
    inodes: filesystem.ffree,
    oomKilled,
    downloadLimitExceeded,
    sandboxStartFailed,
  });
  return { ...result, oomKilled, downloadLimitExceeded, ...(failure ? { failure } : {}) };
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
  const config = JSON.parse(
    (await readBoundedFile("/etc/docker/daemon.json", 64 * 1024)).toString("utf8"),
  );
  const runtime = config.runtimes?.runsc;
  if (
    runtime?.path !== "/usr/local/bin/runsc" ||
    JSON.stringify(runtime.runtimeArgs) !== JSON.stringify(["--platform=systrap"]) ||
    !(await command("/usr/local/bin/runsc", ["--version"])).startsWith(
      "runsc version release-20260928.0\n",
    )
  )
    throw new PreparationError(
      "runner_unavailable",
      "The execution host must use the pinned runsc systrap configuration.",
    );
}
