import { join, resolve } from "node:path";
import {
  MAX_LOCK_BYTES,
  PreparationError,
  type ResolvedArtifact,
  validateLock,
} from "@compatlab/engine";
import { inspectTree, readBoundedFile } from "./files.js";
import {
  assertPreparationHost,
  INSTALLER_IMAGE,
  PREPARATION_PROFILE,
  type PreparedSnapshot,
} from "./prepare.js";
import { WorkspaceVolume } from "./volume.js";

export async function reuseSnapshot(
  id: string,
  stateDirectory: string,
  artifact: ResolvedArtifact,
  signal?: AbortSignal,
): Promise<PreparedSnapshot> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
    throw new TypeError("Expected a snapshot UUID.");
  await assertPreparationHost();
  const directory = join(resolve(stateDirectory), id);
  const workspace = join(directory, "volume", "workspace");
  const metadataBytes = await readBoundedFile(join(directory, "snapshot.json"), 64 * 1024);
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(metadataBytes));
  } catch {
    throw new PreparationError(
      "artifact_integrity_mismatch",
      "The retained snapshot metadata is corrupt.",
    );
  }
  const storedArtifact = record(metadata) && record(metadata.artifact) ? metadata.artifact : {};
  if (
    !record(metadata) ||
    metadata.schemaVersion !== 1 ||
    metadata.id !== id ||
    metadata.sealed !== true ||
    typeof metadata.generation !== "string" ||
    !/^[a-f0-9-]{36}$/.test(metadata.generation) ||
    metadata.profileRevision !== PREPARATION_PROFILE ||
    metadata.installerImage !== INSTALLER_IMAGE ||
    !record(metadata.artifact) ||
    (["name", "version", "integrity", "tarballUrl"] as const).some(
      (key) => storedArtifact[key] !== artifact[key],
    )
  )
    throw new PreparationError(
      "artifact_integrity_mismatch",
      "The retained snapshot identity does not match the request.",
    );
  const volume = await WorkspaceVolume.reopen(directory);
  const lock = validateLock(
    await readBoundedFile(join(workspace, "package-lock.json"), MAX_LOCK_BYTES),
    artifact,
  );
  const tree = await inspectTree(workspace, undefined, signal);
  if (lock.digest !== metadata.lockDigest || tree.digest !== metadata.treeDigest)
    throw new PreparationError(
      "artifact_integrity_mismatch",
      "The retained snapshot bytes changed.",
    );
  const present = new Set(
    tree.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
  );
  return {
    id,
    generation: metadata.generation,
    directory,
    workspace,
    artifact,
    profileRevision: PREPARATION_PROFILE,
    installerImage: INSTALLER_IMAGE,
    installerVersion: "11.19.0",
    platform: "linux_amd64",
    lock,
    tree,
    installed: lock.dependencies
      .filter((entry) => present.has(entry.location))
      .map((entry) => entry.location),
    omittedOptional: lock.dependencies
      .filter((entry) => entry.optional && !present.has(entry.location))
      .map((entry) => entry.location),
    logs: [],
    dispose: () => volume.dispose(),
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
