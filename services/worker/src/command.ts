import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { CleanupError } from "./lifecycle/cleanup.js";

const exec = promisify(execFile);
export async function command(
  file: string,
  args: string[],
  timeout = 10_000,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await exec(file, args, {
    timeout,
    maxBuffer: 128 * 1024,
    encoding: "utf8",
    signal,
    killSignal: "SIGKILL",
  });
  return stdout.trim();
}
export const docker = (args: string[], timeout?: number, signal?: AbortSignal) =>
  command("docker", args, timeout, signal);

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stderrTail: string;
  emittedBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  termination: "completed" | "cancelled" | "output_limit_exceeded";
};
export function streamCommand(
  file: string,
  args: string[],
  signal: AbortSignal,
  observeStderr?: (bytes: Buffer) => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    const logs = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const retained = { stdout: 0, stderr: 0 };
    const truncated = { stdout: false, stderr: false };
    let emittedBytes = 0;
    let stderrTail = Buffer.alloc(0);
    let termination: CommandResult["termination"] = "completed";
    const abort = () => {
      if (termination === "completed") termination = "cancelled";
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].on("data", (buffer: Buffer) => {
        emittedBytes += buffer.length;
        if (stream === "stderr") {
          stderrTail = Buffer.from(Buffer.concat([stderrTail, buffer]).subarray(-16 * 1024));
          observeStderr?.(buffer);
        }
        const available = (stream === "stderr" ? 112 : 128) * 1024 - retained[stream];
        if (buffer.length > available) truncated[stream] = true;
        if (available > 0) {
          const bytes = buffer.subarray(0, available);
          logs[stream].push(bytes);
          retained[stream] += bytes.length;
        }
        if (emittedBytes > 8 * 1024 * 1024) {
          if (termination === "completed") termination = "output_limit_exceeded";
          child.kill("SIGKILL");
        }
      });
    }
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (exitCode) => {
      signal.removeEventListener("abort", abort);
      resolve({
        exitCode,
        termination,
        emittedBytes,
        stdoutTruncated: truncated.stdout,
        stderrTruncated: truncated.stderr,
        stdout: Buffer.concat(logs.stdout).toString("utf8"),
        stderr: Buffer.concat(logs.stderr).toString("utf8"),
        stderrTail: stderrTail.toString("utf8"),
      });
    });
  });
}

export async function removeContainer(name: string): Promise<void> {
  if (!/^compatlab-[a-z0-9-]+$/.test(name))
    throw new TypeError("Expected a CompatLab container name.");
  try {
    await docker(["rm", "--force", name]);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("stderr" in error) ||
      typeof error.stderr !== "string" ||
      !error.stderr.includes(`No such container: ${name}`)
    )
      throw new CleanupError(error);
  }
}
