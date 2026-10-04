import { createHash, randomUUID } from "node:crypto";
import { assertionDigest } from "../../packages/engine/dist/index.js";

export async function seedAssertion(catalog) {
  const parent = (
    await catalog.pool.query(
      "SELECT s.*,v.version,pkg.name FROM scans s JOIN preparations p ON p.id=s.preparation_id JOIN package_versions v ON v.id=p.artifact_id JOIN packages pkg ON pkg.id=v.package_id WHERE s.state='completed' ORDER BY s.requested_at DESC LIMIT 1",
    )
  ).rows[0];
  if (!parent) throw new Error("Expected a completed browser fixture.");
  const source = Buffer.from("export default ()=>{throw Error('Expected behavior failed.')}");
  const bundle = {
    schemaVersion: 1,
    harnessRevision: "assertion_v1",
    policyRevision: "runtime_limits_v2",
    repository: "owner/package",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    manifestPath: "manifest.json",
    manifest: {
      schemaVersion: 1,
      name: "documented-behavior",
      packageName: parent.name,
      packageRange: "*",
      entry: "probe.mjs",
      timeoutMs: 1000,
      capabilities: {
        network: "none",
        filesystem: "read_only_workspace_and_bounded_temporary_output",
        processes: "bounded",
      },
      fixtures: [],
      expectedBehavior: "The documented behavior succeeds.",
    },
    files: [
      {
        path: "probe.mjs",
        base64: source.toString("base64"),
        sha256: createHash("sha256").update(source).digest("hex"),
        gitBlobSha: createHash("sha1")
          .update(`blob ${source.length}\0`)
          .update(source)
          .digest("hex"),
      },
    ],
  };
  const userId = randomUUID(),
    linkId = randomUUID(),
    revisionId = randomUUID(),
    scanId = randomUUID();
  await catalog.pool.query(
    "INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,'fixture',$2,true)",
    [userId, `${userId}@example.com`],
  );
  await catalog.pool.query(
    "INSERT INTO repository_links(id,user_id,repository_id,installation_id,full_name) VALUES($1,$2,'51','9','owner/package')",
    [linkId, userId],
  );
  await catalog.pool.query(
    "INSERT INTO probe_revisions(id,owner_user_id,repository_link_id,digest,bundle) VALUES($1,$2,$3,$4,$5)",
    [revisionId, userId, linkId, assertionDigest(bundle), JSON.stringify(bundle)],
  );
  await catalog.pool.query(
    "INSERT INTO scans(id,preparation_id,matrix_id,observation_revision,previous_scan_id,assertion_revision_id,state,requester_expires_at,admission_policy) VALUES($1,$2,$3,$4,$5,$6,'requested',now()+interval '1 day','admission_v4')",
    [
      scanId,
      parent.preparation_id,
      parent.matrix_id,
      parent.observation_revision + 1,
      parent.id,
      revisionId,
    ],
  );
  return scanId;
}

export function assertionResult(job) {
  const probeId = randomUUID();
  return {
    kind: "assertion",
    evidence: {
      revisionDigest: job.revisionDigest,
      profileId: job.image.profileId,
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
            {
              index: 0,
              outcome: "fail",
              resolvedTo: null,
              durationMs: 1,
              error: { name: "AssertionError", message: "Expected behavior failed.", code: null },
            },
          ],
        },
        logs: {
          stdout: "",
          stderr: "",
          emittedBytes: 0,
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      },
    },
  };
}
