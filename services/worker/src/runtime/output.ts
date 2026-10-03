import { mkdir, rm } from "node:fs/promises";
import { command } from "../command.js";

export class OutputVolume {
  private constructor(readonly path: string) {}
  static async create(path: string): Promise<OutputVolume> {
    const volume = new OutputVolume(path);
    await mkdir(path, { mode: 0o700 });
    try {
      await command("mount", [
        "-t",
        "tmpfs",
        "-o",
        "size=8m,nr_inodes=64,mode=0777,nodev,nosuid,noexec",
        "tmpfs",
        path,
      ]);
      return volume;
    } catch (error) {
      await volume.dispose();
      throw error;
    }
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
    await rm(this.path, { recursive: true, force: true });
  }
}
