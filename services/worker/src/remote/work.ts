import { join } from "node:path";
import { type JobAssignment, type JobResult, jobResultSchema } from "@compatlab/contracts";
import { executePlan, manifestObservations, PreparationError } from "@compatlab/engine";
import { docker } from "../command.js";
import { CleanupError } from "../lifecycle/cleanup.js";
import type { ExecutionSupervisor } from "../lifecycle/supervisor.js";
import { readBoundedFile } from "../preparation/files.js";
import { INSTALLER_IMAGE, PREPARATION_PROFILE } from "../preparation/prepare.js";
import { PROXY_IMAGE } from "../preparation/proxy.js";
import { reuseSnapshot } from "../preparation/reuse.js";
import { verifyRuntimeImages } from "../runtime/images.js";

export async function executeAssignment(
  supervisor: ExecutionSupervisor,
  job: JobAssignment,
  signal: AbortSignal,
): Promise<JobResult> {
  try {
    return await supervisor.withScan(async (scope) => {
      const artifact = { ...job.artifact, manifest: {}, observedTags: {} };
      if (job.kind === "preparation") {
        if (job.profileRevision !== PREPARATION_PROFILE)
          throw new TypeError("Preparation profile is unavailable.");
        for (const image of [INSTALLER_IMAGE, PROXY_IMAGE])
          await docker(["pull", "--platform=linux/amd64", image], 180_000);
        signal.throwIfAborted();
        const snapshot = await supervisor.prepare(artifact, scope, signal);
        const manifest = await readBoundedFile(
          join(snapshot.workspace, "node_modules", artifact.name, "package.json"),
          2 * 1024 ** 2,
        );
        const lock = await readBoundedFile(
          join(snapshot.workspace, "package-lock.json"),
          16 * 1024 ** 2,
        );
        return jobResultSchema.parse({
          kind: "preparation",
          snapshot: {
            id: snapshot.id,
            generation: snapshot.generation,
            lockDigest: snapshot.lock.digest,
            treeDigest: snapshot.tree.digest,
            profileRevision: snapshot.profileRevision,
            installerImage: snapshot.installerImage,
          },
          lockBase64: lock.toString("base64"),
          manifestJson: manifest.toString("utf8"),
          staticObservations: manifestObservations(
            manifest,
            snapshot.tree.entries.map((entry) => entry.path),
          ),
          installed: snapshot.installed,
          omittedOptional: snapshot.omittedOptional,
        });
      }
      await verifyRuntimeImages([job.image]);
      supervisor.pinSnapshot(job.snapshot.id, scope);
      const snapshot = await reuseSnapshot(
        job.snapshot.id,
        join(supervisor.stateDirectory, "snapshots"),
        artifact,
        signal,
      );
      if (
        snapshot.generation !== job.snapshot.generation ||
        snapshot.lock.digest !== job.snapshot.lockDigest ||
        snapshot.tree.digest !== job.snapshot.treeDigest ||
        snapshot.profileRevision !== job.snapshot.profileRevision ||
        snapshot.installerImage !== job.snapshot.installerImage
      )
        throw new TypeError("The assigned snapshot is unavailable or changed.");
      const runtime = job.plan.runtimes.find(
        (runtime) => runtime.profileId === job.image.profileId,
      );
      if (!runtime) throw new TypeError("The assigned runtime is missing from its plan.");
      const selected = (entry: typeof runtime.root, enabled: boolean) => ({
        ...entry,
        esm:
          enabled && job.mode === "esm"
            ? entry.esm
            : { applicable: false as const, reason: "not_exported" as const },
        commonjs:
          enabled && job.mode === "commonjs"
            ? entry.commonjs
            : { applicable: false as const, reason: "not_exported" as const },
      });
      const plan = {
        ...job.plan,
        runtimes: [
          {
            ...runtime,
            root: selected(runtime.root, job.group === "root"),
            entries:
              job.group === "subpaths" ? runtime.entries.map((entry) => selected(entry, true)) : [],
          },
        ],
      };
      const backend = await supervisor.backend(snapshot, [job.image], scope);
      let logsRemaining = job.maxLogBytes;
      const results = await executePlan(
        plan,
        [job.image],
        {
          async run(input, image, signal) {
            const session = await backend.run(input, image, signal);
            for (const stream of ["stdout", "stderr"] as const) {
              const bytes = Buffer.from(session.logs[stream]);
              if (bytes.length > logsRemaining) session.logs[`${stream}Truncated`] = true;
              session.logs[stream] = new TextDecoder().decode(bytes.subarray(0, logsRemaining), {
                stream: true,
              });
              logsRemaining -= Math.min(bytes.length, logsRemaining);
            }
            return session;
          },
        },
        signal,
        Math.max(1024, job.maxEvidenceBytes - 4096),
      );
      const evidence = results.find(
        (result) => result.group === job.group && result.mode === job.mode,
      );
      if (!evidence) throw new Error("Assigned probe result missing.");
      return { kind: "run", evidence };
    });
  } catch (error) {
    if (signal.aborted || error instanceof CleanupError || supervisor.capacity.blocked) throw error;
    if (
      job.kind === "preparation" &&
      error instanceof PreparationError &&
      !["runner_unavailable", "sandbox_start_failed"].includes(error.classification)
    )
      return {
        kind: "failure",
        origin: "preparation",
        classification: error.classification,
        message: error.message.slice(0, 2048),
      };
    return {
      kind: "failure",
      origin: "infrastructure",
      classification: "runner_unavailable",
      message: "The worker could not complete this attempt.",
    };
  }
}
