import { createHash, randomUUID } from "node:crypto";
import type { AssertionBundle, AssertionEvidence } from "../packages/contracts/src/index.js";
import { assertionDigest } from "../packages/engine/src/index.js";
export function assertionBundle(
  packageName = "assertion-fixture",
  source = "export default async function () {}",
  fixtures: Record<string, string> = {},
): AssertionBundle {
  const files = { "probe.mjs": source, ...fixtures };
  return {
    schemaVersion: 1,
    harnessRevision: "assertion_v1",
    policyRevision: "runtime_limits_v2",
    repository: "owner/package",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    manifestPath: "manifest.json",
    manifest: {
      schemaVersion: 1,
      name: "basic-behavior",
      packageName,
      packageRange: "*",
      entry: "probe.mjs",
      timeoutMs: 1000,
      capabilities: {
        network: "none",
        filesystem: "read_only_workspace_and_bounded_temporary_output",
        processes: "bounded",
      },
      fixtures: Object.keys(fixtures),
      expectedBehavior: "The documented behavior succeeds.",
    },
    files: Object.entries(files).map(([path, value]) => {
      const bytes = Buffer.from(value);
      return {
        path,
        gitBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        base64: bytes.toString("base64"),
      };
    }),
  };
}
export function assertionEvidence(
  bundle: AssertionBundle,
  profileId: string,
  fail = false,
): AssertionEvidence {
  const probeId = randomUUID();
  return {
    revisionDigest: assertionDigest(bundle),
    profileId,
    session: {
      probeId,
      startIndex: 0,
      stopReason: "completed",
      exitCode: 0,
      oomKilled: false,
      durationMs: 1,
      checkpoint: {
        schemaVersion: 2,
        probeId,
        mode: "esm",
        group: "root",
        completed: true,
        activeIndex: null,
        observations: [
          fail
            ? {
                index: 0,
                outcome: "fail",
                resolvedTo: null,
                durationMs: 1,
                error: { name: "AssertionError", message: "Expected behavior failed.", code: null },
              }
            : {
                index: 0,
                outcome: "pass",
                resolvedTo: null,
                durationMs: 1,
                valueType: "undefined",
              },
        ],
      },
      logs: {
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        emittedBytes: 0,
      },
    },
  };
}
