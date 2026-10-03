import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { PreparationError } from "@compatlab/engine";
import { command } from "../command.js";

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
    const file = await open(join(directory, "workspace.ext4"), "wx", 0o600);
    try {
      await file.truncate(bytes);
    } finally {
      await file.close();
    }
    await mkdir(volume.path, { mode: 0o755 });
    try {
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

  static async reopen(directory: string): Promise<WorkspaceVolume> {
    const volume = new WorkspaceVolume(directory);
    const options = await command("findmnt", [
      "--noheadings",
      "--mountpoint",
      volume.path,
      "--output",
      "OPTIONS",
    ]);
    if (!options.split(",").includes("ro"))
      throw new PreparationError("archive_rejected", "The retained workspace is not sealed.");
    return volume;
  }

  async dispose(): Promise<void> {
    let mounted = true;
    try {
      await command("mountpoint", ["--quiet", this.path]);
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 32)
        throw error;
      mounted = false;
    }
    if (mounted) {
      await command("umount", [this.path]);
    }
    await rm(this.directory, { recursive: true, force: true });
  }
}
