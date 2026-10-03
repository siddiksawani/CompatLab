import { spawn } from "node:child_process";
import { lstat, open, readFile, writeFile } from "node:fs/promises";
import { readBoundedFile } from "../preparation/files.js";

const leasePath = "/run/compatlab-worker.lock";
type Owner = {
  schemaVersion: 1;
  pid: number;
  processStart: string;
  stateDirectory: string;
  active: boolean;
};
export async function acquireHostLease(
  stateDirectory: string,
): Promise<{ previousState: string | null; lost: AbortSignal; close(): Promise<void> }> {
  const file = await open(leasePath, "ax", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    return null;
  });
  await file?.close();
  const info = await lstat(leasePath);
  if (!info.isFile() || info.uid !== 0 || (info.mode & 0o077) !== 0)
    throw new Error("The execution-host lease is not protected.");
  const child = spawn(
    "flock",
    [
      "--no-fork",
      "--exclusive",
      "--nonblock",
      leasePath,
      process.execPath,
      "-e",
      "process.stdout.write('locked'); process.stdin.resume();",
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const lost = new AbortController();
  let closing = false;
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => {
      if (!closing) lost.abort(new Error("The execution-host lease was lost."));
      resolve();
    }),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Execution-host lease acquisition timed out."));
      }, 5000);
      const fail = () => {
        clearTimeout(timer);
        reject(new Error("Another CompatLab supervisor owns this host."));
      };
      child.once("error", fail);
      child.once("close", fail);
      child.stdout.once("data", (bytes) => {
        clearTimeout(timer);
        if (bytes.toString() !== "locked") fail();
        else resolve();
      });
    });
    const bytes = await readBoundedFile(leasePath, 8192);
    const previous: unknown = bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
    let previousState: string | null = null;
    if (previous !== null) {
      if (!isOwner(previous)) throw new Error("The previous worker ownership record is invalid.");
      if (previous.active && (await processStart(previous.pid)) === previous.processStart)
        throw new Error(
          "The previous supervisor is still alive; recovery cannot take its resources.",
        );
      previousState = previous.stateDirectory;
    }
    const owner: Owner = {
      schemaVersion: 1,
      pid: process.pid,
      processStart: await processStart(process.pid),
      stateDirectory,
      active: true,
    };
    if (!owner.processStart) throw new Error("Process identity is unavailable.");
    await writeFile(leasePath, JSON.stringify(owner), { mode: 0o600 });
    return {
      previousState,
      lost: lost.signal,
      async close() {
        if (closing) return;
        closing = true;
        await writeFile(leasePath, JSON.stringify({ ...owner, active: false }), { mode: 0o600 });
        child.stdin.end();
        await exited;
      },
    };
  } catch (error) {
    closing = true;
    child.stdin.end();
    child.kill("SIGKILL");
    await exited;
    throw error;
  }
}
async function processStart(pid: number): Promise<string> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? "";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return "";
    throw error;
  }
}
function isOwner(value: unknown): value is Owner {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    Number.isSafeInteger(record.pid) &&
    Number(record.pid) > 0 &&
    typeof record.processStart === "string" &&
    /^\d+$/.test(record.processStart) &&
    typeof record.stateDirectory === "string" &&
    record.stateDirectory.startsWith("/") &&
    record.stateDirectory.length <= 4096 &&
    typeof record.active === "boolean"
  );
}
