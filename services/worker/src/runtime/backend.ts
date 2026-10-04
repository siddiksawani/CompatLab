import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  type AssertionBundle,
  type AssertionEvidence,
  MAX_BATCH_BYTES,
  PROBE_LIMITS,
  type ProbeCheckpoint,
  type ProbeInput,
  type ProbeSession,
  parseProbeCheckpoint,
  probeInputSchema,
  type RuntimeImage,
  type StopReason,
} from "@compatlab/contracts";
import {
  assertionDigest,
  runtimeArguments,
  type SandboxBackend,
  validateAssertionBundle,
} from "@compatlab/engine";
import { type CommandResult, docker, removeContainer, streamCommand } from "../command.js";
import { readBoundedFile } from "../preparation/files.js";
import { assertPreparationHost } from "../preparation/prepare.js";
import { runtimeContainerArguments } from "./arguments.js";
import { verifyRuntimeImages } from "./images.js";
import { type RuntimeState, runtimeOutcome } from "./outcome.js";
import { OutputVolume } from "./output.js";

type Limits = { entryMs: number; batchMs: number };
export async function createProbeBackend(
  workspace: string,
  stateDirectory: string,
  images: readonly RuntimeImage[],
  limits: Limits = PROBE_LIMITS,
): Promise<SandboxBackend> {
  await assertPreparationHost();
  await verifyRuntimeImages(images);
  for (const key of ["entryMs", "batchMs"] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 100 || limits[key] > PROBE_LIMITS[key])
      throw new TypeError("Invalid probe deadline.");
  const approved = new Set(images.map((image) => JSON.stringify(image)));
  const jobs = resolve(stateDirectory);
  await mkdir(jobs, { recursive: true, mode: 0o700 });
  return {
    async run(rawInput, image, signal) {
      const input = probeInputSchema.parse(rawInput);
      if (!approved.has(JSON.stringify(image)))
        throw new TypeError("The runtime was not verified for this backend.");
      return runSession(input, image, workspace, jobs, limits, signal);
    },
  };
}

async function runSession(
  input: ProbeInput,
  image: RuntimeImage,
  workspace: string,
  jobs: string,
  limits: Limits,
  signal: AbortSignal,
  assertion?: AssertionBundle,
): Promise<ProbeSession> {
  const started = performance.now();
  const directory = join(jobs, randomUUID());
  const name = `compatlab-runtime-${randomUUID()}`;
  const controller = new AbortController();
  let reason: StopReason | null = null;
  let checkpoint: ProbeCheckpoint | null = null;
  let output: OutputVolume | undefined;
  let removed = false;
  const stop = (value: StopReason) => {
    if (!reason) {
      reason = value;
      controller.abort();
    }
  };
  const cancelled = () =>
    stop(
      signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
        ? "scan_deadline"
        : "cancelled",
    );
  signal.addEventListener("abort", cancelled, { once: true });
  const result: ProbeSession = {
    probeId: input.probeId,
    startIndex: input.startIndex,
    stopReason: "sandbox_start_failed",
    exitCode: null,
    oomKilled: false,
    durationMs: 0,
    checkpoint: null,
    logs: {
      stdout: "",
      stderr: "",
      emittedBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  };
  if (signal.aborted) {
    cancelled();
    signal.removeEventListener("abort", cancelled);
    return { ...result, stopReason: reason ?? "cancelled" };
  }
  try {
    await mkdir(directory, { mode: 0o700 });
    const harness = join(directory, "harness");
    await mkdir(harness, { mode: 0o755 });
    await copyFile(
      fileURLToPath(
        new URL(`../../../../harnesses/${assertion ? "assertion" : "probe"}.mjs`, import.meta.url),
      ),
      join(harness, assertion ? "assertion.mjs" : "probe.mjs"),
    );
    if (assertion)
      for (const file of assertion.files) {
        const path = join(harness, "source", file.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o755 });
        await writeFile(path, Buffer.from(file.base64, "base64"), { mode: 0o644, flag: "wx" });
      }
    await writeFile(
      join(harness, "input.json"),
      JSON.stringify({
        ...input,
        ...(assertion ? { assertion: { entry: assertion.manifest.entry } } : {}),
      }),
      {
        mode: 0o644,
        flag: "wx",
      },
    );
    output = await OutputVolume.create(join(directory, "output"));
    let progressAt = performance.now();
    const readCheckpoint = async () => {
      const value = parseProbeCheckpoint(
        await readBoundedFile(
          join(output?.path ?? "", "checkpoint.json"),
          input.group === "root" ? 64 * 1024 : MAX_BATCH_BYTES,
        ),
        input,
      );
      if (
        checkpoint &&
        (value.observations.length < checkpoint.observations.length ||
          checkpoint.observations.some(
            (entry, index) => JSON.stringify(entry) !== JSON.stringify(value.observations[index]),
          ))
      )
        throw new TypeError("Checkpoint history changed.");
      if (
        !checkpoint ||
        value.observations.length !== checkpoint.observations.length ||
        value.activeIndex !== checkpoint.activeIndex ||
        value.completed !== checkpoint.completed
      )
        progressAt = performance.now();
      checkpoint = value;
    };
    let finished = false;
    controller.signal.throwIfAborted();
    await docker([
      ...runtimeContainerArguments({
        name,
        image,
        workspace,
        harness,
        output: output.path,
        operation: "create",
      }),
      ...runtimeArguments(
        image.kind,
        assertion ? "/workspace/.compatlab/assertion.mjs" : "/workspace/.compatlab/probe.mjs",
      ),
    ]);
    controller.signal.throwIfAborted();
    const commandResult = streamCommand(
      "docker",
      ["start", "--attach", name],
      controller.signal,
    ).finally(() => {
      finished = true;
    });
    void commandResult.catch(() => {});
    while (!finished && !controller.signal.aborted) {
      try {
        await readCheckpoint();
      } catch (error) {
        if (!missing(error)) stop("harness_protocol_error");
      }
      const now = performance.now();
      if (!finished && now - started >= (input.group === "root" ? limits.entryMs : limits.batchMs))
        stop(input.group === "root" ? "entry_timeout" : "batch_timeout");
      else if (!finished && now - progressAt >= limits.entryMs) stop("entry_timeout");
      if (!finished && !controller.signal.aborted) await delay(100);
    }
    const processResult = await commandResult;
    result.exitCode = processResult.exitCode;
    result.logs = logs(processResult);
    let state: RuntimeState | null = null;
    try {
      state = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", name]));
      result.oomKilled = state?.OOMKilled === true;
      if (state && !state.Running) result.exitCode = state.ExitCode;
    } catch {}
    await removeContainer(name);
    removed = true;
    let finalValid = false;
    try {
      await readCheckpoint();
      finalValid = true;
    } catch {}
    const filesystem = await statfs(output.path);
    if (!reason && (filesystem.bavail === 0 || filesystem.ffree === 0))
      reason = "output_limit_exceeded";
    result.stopReason = runtimeOutcome(
      processResult,
      state,
      reason,
      finalValid && (checkpoint as ProbeCheckpoint | null)?.completed === true,
    );
    result.checkpoint = checkpoint;
    result.durationMs = performance.now() - started;
    return result;
  } catch (error) {
    result.stopReason = reason ?? "sandbox_start_failed";
    result.checkpoint = checkpoint;
    result.durationMs = performance.now() - started;
    result.logs.stderr =
      error instanceof Error ? error.message.slice(0, 4096) : "The runtime could not start.";
    return result;
  } finally {
    signal.removeEventListener("abort", cancelled);
    if (!removed) await removeContainer(name);
    if (output) await output.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function logs(result: CommandResult): ProbeSession["logs"] {
  const stderr = result.stderrTruncated
    ? Buffer.from(`${result.stderr}\n[retained tail]\n${result.stderrTail}`)
        .subarray(0, 128 * 1024)
        .toString("utf8")
    : result.stderr;
  return {
    stdout: result.stdout,
    stderr,
    emittedBytes: result.emittedBytes,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
}

export async function runAssertion(
  workspace: string,
  stateDirectory: string,
  image: RuntimeImage,
  raw: AssertionBundle,
  signal: AbortSignal,
): Promise<AssertionEvidence> {
  const bundle = validateAssertionBundle(raw);
  await assertPreparationHost();
  await verifyRuntimeImages([image]);
  const jobs = resolve(stateDirectory);
  await mkdir(jobs, { recursive: true, mode: 0o700 });
  const input: ProbeInput = {
    schemaVersion: 2,
    probeId: randomUUID(),
    mode: "esm",
    group: "root",
    entries: [bundle.manifest.packageName],
    startIndex: 0,
  };
  return {
    profileId: image.profileId,
    revisionDigest: assertionDigest(bundle),
    session: await runSession(
      input,
      image,
      workspace,
      jobs,
      { entryMs: bundle.manifest.timeoutMs, batchMs: PROBE_LIMITS.batchMs },
      signal,
      bundle,
    ),
  };
}
