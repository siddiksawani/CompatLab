import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { command, docker, removeContainer } from "../command.js";
import { readBoundedFile } from "../preparation/files.js";
import { cleanup } from "./cleanup.js";
import { privateDirectory } from "./storage.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function recoverResources(stateDirectory: string): Promise<void> {
  await privateDirectory(stateDirectory);
  await cleanup(async () => {
    const names = await docker([
      "ps",
      "--all",
      "--filter",
      "label=compatlab.managed=true",
      "--format",
      "{{.Names}}",
    ]);
    for (const name of names.split("\n").filter(Boolean)) await removeContainer(name);
    const networks = await docker([
      "network",
      "ls",
      "--filter",
      "label=compatlab.managed=true",
      "--format",
      "{{.Name}}",
    ]);
    for (const name of networks.split("\n").filter(Boolean)) {
      const id = name.replace(/^compatlab-prep-/, "");
      if (!uuid.test(id)) throw new Error("Unrecognized managed preparation network.");
      const subnet = await docker([
        "network",
        "inspect",
        name,
        "--format",
        "{{(index .IPAM.Config 0).Subnet}}",
      ]);
      const match = /^(\d+)\.(\d+)\.(\d+)\.\d+\/\d+$/.exec(subnet);
      if (!match) throw new Error("Unrecognized preparation subnet.");
      const jobIp = `${match[1]}.${match[2]}.${match[3]}.3`;
      const chain = `CL${id.replaceAll("-", "").slice(0, 20)}`;
      for (const rule of [
        ["INPUT", "-s", jobIp, "-j", "DROP"],
        ["DOCKER-USER", "-s", jobIp, "-j", chain],
        ["DOCKER-USER", "-d", jobIp, "-j", chain],
      ]) {
        if (await existsCommand("iptables", ["-w", "-C", ...rule]))
          await command("iptables", ["-w", "-D", ...rule]);
      }
      if (await existsCommand("iptables", ["-w", "-S", chain])) {
        await command("iptables", ["-w", "-F", chain]);
        await command("iptables", ["-w", "-X", chain]);
      }
      await docker(["network", "rm", name]);
    }
    const jobs = await privateDirectory(join(stateDirectory, "jobs"));
    for (const id of await readdir(jobs)) {
      if (!uuid.test(id)) throw new Error("Unrecognized worker job directory.");
      const directory = await privateDirectory(join(jobs, id));
      const output = join(directory, "output");
      if (await existsCommand("mountpoint", ["--quiet", output], [1, 32]))
        await command("umount", [output]);
      await rm(directory, { recursive: true });
    }
  });
}

export async function collectSnapshots(
  stateDirectory: string,
  protectedIds: ReadonlySet<string> = new Set(),
  maximumBytes = 8 * 1024 ** 3,
): Promise<number> {
  const directory = await privateDirectory(join(stateDirectory, "snapshots"));
  const retained: { id: string; path: string; bytes: number; created: number }[] = [];
  for (const id of await readdir(directory)) {
    if (!uuid.test(id)) throw new Error("Unrecognized snapshot directory.");
    const path = await privateDirectory(join(directory, id));
    let ready = false;
    try {
      const metadata = JSON.parse(
        (await readBoundedFile(join(path, "snapshot.json"), 64 * 1024)).toString("utf8"),
      );
      ready = metadata.schemaVersion === 1 && metadata.id === id && metadata.sealed === true;
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    if (!ready) {
      if (protectedIds.has(id)) throw new Error("An active snapshot is incomplete.");
      await cleanup(async () => {
        await disposeSnapshot(path);
      });
      continue;
    }
    const file = await lstat(join(path, "workspace.ext4"));
    if (!file.isFile() || file.uid !== 0) throw new Error("Invalid snapshot backing file.");
    const created = (await lstat(join(path, "snapshot.json"))).mtimeMs;
    retained.push({ id, path, bytes: file.blocks * 512, created });
  }
  let total = retained.reduce((sum, item) => sum + item.bytes, 0);
  for (const item of retained.sort((a, b) => a.created - b.created)) {
    if (protectedIds.has(item.id)) continue;
    if (Date.now() - item.created > 7 * 24 * 60 * 60 * 1000 || total > maximumBytes) {
      await cleanup(() => disposeSnapshot(item.path));
      total -= item.bytes;
    }
  }
  if (total > maximumBytes) throw new Error("Retained snapshots exceed the storage budget.");
  return total;
}
async function disposeSnapshot(path: string): Promise<void> {
  const volume = join(path, "volume");
  if (await existsCommand("mountpoint", ["--quiet", volume], [1, 32])) {
    // Incomplete preparations may still be writable; disposal does not require reopening them for reuse.
    await command("umount", [volume]);
  }
  await rm(path, { recursive: true });
}
async function existsCommand(file: string, args: string[], absent = [1]): Promise<boolean> {
  try {
    await command(file, args);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      absent.includes(Number(error.code))
    )
      return false;
    throw error;
  }
}
