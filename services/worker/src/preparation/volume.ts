import { lstat, mkdir, open, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PreparationError } from "@compatlab/engine";
import { command } from "../command.js";
import { cleanup } from "../lifecycle/cleanup.js";
import { privateDirectory } from "../lifecycle/storage.js";

const reopening = new Map<string, Promise<WorkspaceVolume>>();

export class WorkspaceVolume {
  readonly path: string;
  private constructor(readonly directory: string) {
    this.path = join(directory, "volume");
  }

  static async create(
    directory: string,
    bytes = 2 * 1024 ** 3,
    inodes = 100_000,
  ): Promise<WorkspaceVolume> {
    if (process.platform !== "linux" || process.arch !== "x64" || process.geteuid?.() !== 0)
      throw new PreparationError(
        "runner_unavailable",
        "Preparation requires a local Linux amd64 execution host with mount privileges.",
      );
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 64 * 1024 ** 2 ||
      bytes > 2 * 1024 ** 3 ||
      !Number.isSafeInteger(inodes) ||
      inodes < 1024 ||
      inodes > 100_000
    )
      throw new TypeError("Invalid workspace quota.");
    const volume = new WorkspaceVolume(directory);
    await mkdir(directory, { mode: 0o700 });
    try {
      const file = await open(join(directory, "workspace.ext4"), "wx", 0o600);
      try {
        await file.truncate(bytes);
      } finally {
        await file.close();
      }
      await mkdir(volume.path, { mode: 0o755 });
      await command(
        "mkfs.ext4",
        [
          "-q",
          "-F",
          "-m",
          "0",
          "-N",
          String(inodes),
          "-O",
          "^has_journal",
          join(directory, "workspace.ext4"),
        ],
        30_000,
      );
      await command("mount", [
        "-o",
        "loop,nodev,nosuid,noexec",
        join(directory, "workspace.ext4"),
        volume.path,
      ]);
      return volume;
    } catch (error) {
      await volume.dispose();
      throw error;
    }
  }

  async seal(): Promise<void> {
    await command("mount", ["-o", "remount,ro,nodev,nosuid,exec", this.path]);
  }

  static reopen(directory: string): Promise<WorkspaceVolume> {
    const path = resolve(directory);
    let pending = reopening.get(path);
    if (!pending) {
      pending = WorkspaceVolume.restore(path).finally(() => reopening.delete(path));
      reopening.set(path, pending);
    }
    return pending;
  }

  private static async restore(directory: string): Promise<WorkspaceVolume> {
    await privateDirectory(directory);
    const volume = new WorkspaceVolume(directory);
    const backing = join(directory, "workspace.ext4");
    const file = await lstat(backing);
    const target = await lstat(volume.path);
    if (
      !file.isFile() ||
      file.uid !== 0 ||
      file.nlink !== 1 ||
      (file.mode & 0o022) !== 0 ||
      file.size < 64 * 1024 ** 2 ||
      file.size > 2 * 1024 ** 3 ||
      !target.isDirectory() ||
      target.uid !== 0 ||
      (target.mode & 0o022) !== 0
    )
      throw new PreparationError(
        "archive_rejected",
        "The retained workspace backing file or mount directory is unsafe.",
      );
    let mounted = false;
    try {
      let options = await mountOptions(volume.path);
      if (options === null) {
        await command("mount", [
          "-t",
          "ext4",
          "-o",
          "loop,ro,noload,nodev,nosuid,exec",
          backing,
          volume.path,
        ]);
        mounted = true;
        options = await mountOptions(volume.path);
      }
      const flags = new Set(options?.split(","));
      if (!["ro", "nodev", "nosuid"].every((flag) => flags.has(flag)) || flags.has("noexec"))
        throw new PreparationError(
          "archive_rejected",
          "The retained workspace mount policy changed.",
        );
      return volume;
    } catch (error) {
      if (mounted) await cleanup(() => command("umount", [volume.path]).then(() => {}));
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await cleanup(async () => {
      const exists = await lstat(this.path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      let mounted = exists;
      try {
        if (exists) await command("mountpoint", ["--quiet", this.path]);
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 32)
          throw error;
        mounted = false;
      }
      if (mounted) {
        await command("umount", [this.path]);
      }
      await rm(this.directory, { recursive: true, force: true });
    });
  }
}

async function mountOptions(path: string): Promise<string | null> {
  try {
    return await command("findmnt", ["--noheadings", "--mountpoint", path, "--output", "OPTIONS"]);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1)
      return null;
    throw error;
  }
}
