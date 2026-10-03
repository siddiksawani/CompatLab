import { randomUUID } from "node:crypto";
import {
  type JobAssignment,
  type JobResult,
  PREPARATION_INSTALLER_IMAGE,
  PREPARATION_PROFILE_REVISION,
  type ProbeGroupResult,
} from "@compatlab/contracts";
import { hash } from "./fixtures.js";
export function prepared(job: JobAssignment): Extract<JobResult, { kind: "preparation" }> {
  const artifact = job.artifact;
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [artifact.name]: artifact.version } },
      [`node_modules/${artifact.name}`]: {
        version: artifact.version,
        resolved: artifact.tarballUrl,
        integrity: artifact.integrity,
      },
    },
  });
  return {
    kind: "preparation",
    snapshot: {
      id: randomUUID(),
      generation: randomUUID(),
      lockDigest: hash(lock),
      treeDigest: hash("tree"),
      profileRevision: PREPARATION_PROFILE_REVISION,
      installerImage: PREPARATION_INSTALLER_IMAGE,
    },
    lockBase64: Buffer.from(lock).toString("base64"),
    manifestJson: JSON.stringify({
      name: artifact.name,
      version: artifact.version,
      exports: { ".": "./index.js", "./util": "./util.js" },
    }),
    staticObservations: { evidenceLevel: "static_only" },
    installed: [`node_modules/${artifact.name}`],
    omittedOptional: [],
  };
}
export function runEvidence(job: JobAssignment): ProbeGroupResult {
  if (job.kind !== "run") throw new Error("Expected run job.");
  const runtime = job.plan.runtimes.find((runtime) => runtime.profileId === job.image.profileId);
  if (!runtime) throw new Error("Fixture runtime missing.");
  const entries = (job.group === "root" ? [runtime.root] : runtime.entries)
    .filter((entry) => entry[job.mode].applicable)
    .map((entry) => entry.specifier);
  const probeId = randomUUID();
  const observations = entries.map((_entry, index) => ({
    index,
    outcome: "pass" as const,
    resolvedTo: null,
    durationMs: 1,
    valueType: "function" as const,
  }));
  return {
    profileId: job.image.profileId,
    group: job.group,
    mode: job.mode,
    method: job.group === "root" ? "fresh_root_v2" : "sequential_batch_v2",
    entries,
    observations,
    interruptions: [],
    sessions: entries.length
      ? [
          {
            probeId,
            startIndex: 0,
            stopReason: "completed",
            exitCode: 0,
            oomKilled: false,
            durationMs: 1,
            checkpoint: {
              schemaVersion: 2,
              probeId,
              mode: job.mode,
              group: job.group,
              completed: true,
              activeIndex: null,
              observations,
            },
            logs: {
              stdout: "fixture output",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
              emittedBytes: 14,
            },
          },
        ]
      : [],
    coverage: {
      planned: entries.length,
      observed: entries.length,
      interrupted: 0,
      untested: 0,
      complete: true,
    },
  };
}
