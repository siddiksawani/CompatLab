import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../apps/cli/dist/cli.js";
import { ciReportSchema, parseReproductionInputs } from "../packages/contracts/dist/index.js";
import {
  assertionDigest,
  assertionPassed,
  classifyAssertion,
  validateAssertionBundle,
} from "../packages/engine/dist/index.js";
import { command } from "../services/worker/dist/command.js";
import {
  assertPreparationHost,
  checkCiPackage,
  collectSnapshots,
  recoverResources,
  runAssertion,
} from "../services/worker/dist/index.js";

await assertPreparationHost();
const base = await mkdtemp(join(tmpdir(), "compatlab-maintainer-")),
  state = join(base, "state");
try {
  await command("python3", ["fixtures/assertions/build.py", join(base, "fixtures")]);
  const provenance = {
    provider: "github_actions",
    confidence: "caller_supplied",
    repository: "owner/package",
    commit: "a".repeat(40),
    workflow: ".github/workflows/ci.yml",
    runId: "1",
    runAttempt: 1,
  };
  const provenanceFile = join(base, "provenance.json");
  await writeFile(provenanceFile, JSON.stringify(provenance));
  const options = {
    stateDirectory: state,
    provenanceFile,
    artifactFile: join(base, "fixtures/package.tgz"),
  };
  const output = [],
    errors = [];
  const exitCode = await runCli(
    [
      "ci",
      "compatlab-ci-fixture@1.0.0",
      "--artifact",
      options.artifactFile,
      "--provenance",
      provenanceFile,
      "--state-dir",
      state,
      "--json",
    ],
    {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text),
    },
  );
  assert.equal(exitCode, 0, errors.join(""));
  const report = ciReportSchema.parse(JSON.parse(output.join("")));
  assert.equal(report.artifact.kind, "ci_artifact");
  assert.deepEqual(report.artifact.provenance, provenance);
  assert.equal(
    report.artifact.sha256,
    createHash("sha256")
      .update(await readFile(options.artifactFile))
      .digest("hex"),
  );
  assert.throws(() => parseReproductionInputs(report));
  assert.ok(
    report.groups.every(
      (g) => g.coverage.complete && g.observations.every((o) => o.outcome === "pass"),
    ),
  );
  const workspace = join(state, "snapshots", report.snapshot.id, "volume", "workspace");
  await assert.rejects(() => access(join(workspace, "script-ran")));
  for (const [scenario, classification] of [
    ["private", "package_manifest_invalid"],
    ["traversal", "archive_rejected"],
  ])
    await assert.rejects(
      () =>
        checkCiPackage("compatlab-ci-fixture@1.0.0", {
          ...options,
          artifactFile: join(base, `fixtures/${scenario}.tgz`),
        }),
      (error) => error.classification === classification,
    );
  try {
    const links = await checkCiPackage("compatlab-ci-fixture@1.0.0", {
      ...options,
      artifactFile: join(base, "fixtures/symlink.tgz"),
    });
    await assert.rejects(
      () =>
        access(
          join(
            state,
            "snapshots",
            links.snapshot.id,
            "volume/workspace/node_modules/compatlab-ci-fixture/escape",
          ),
        ),
      { code: "ENOENT" },
    );
  } catch (error) {
    if (error.classification !== "archive_rejected") throw error;
  }
  const link = join(base, "archive-link.tgz");
  await symlink(options.artifactFile, link);
  await assert.rejects(() =>
    checkCiPackage("compatlab-ci-fixture@1.0.0", { ...options, artifactFile: link }),
  );
  function bundle(source, timeoutMs = 10000) {
    const contents = { "probe.mjs": source, "fixture.txt": "offline-data" };
    return validateAssertionBundle({
      schemaVersion: 1,
      harnessRevision: "assertion_v1",
      policyRevision: "runtime_limits_v2",
      repository: "owner/package",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      manifestPath: "manifest.json",
      manifest: {
        schemaVersion: 1,
        name: "qualification",
        packageName: "compatlab-ci-fixture",
        packageRange: "*",
        entry: "probe.mjs",
        timeoutMs,
        capabilities: {
          network: "none",
          filesystem: "read_only_workspace_and_bounded_temporary_output",
          processes: "bounded",
        },
        fixtures: ["fixture.txt"],
        expectedBehavior: "Authored containment qualification.",
      },
      files: Object.entries(contents).map(([path, text]) => {
        const bytes = Buffer.from(text);
        return {
          path,
          base64: bytes.toString("base64"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          gitBlobSha: createHash("sha1")
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest("hex"),
        };
      }),
    });
  }
  const scenarios = [
    [
      "pass",
      "import value from 'compatlab-ci-fixture'; export default ()=>{if(value(1)!==2)throw Error('value')}",
    ],
    ["fail", "export default ()=>{throw Error('expected assertion failure')}"],
    ["fake-stdout", 'export default ()=>{console.log(\'{"outcome":"pass"}\');process.exit(0)}'],
    ["timeout", "export default ()=>{while(true){}}"],
    [
      "isolation",
      `import fs from 'node:fs'; export default async ()=>{
    if(fs.readFileSync(new URL('./fixture.txt',import.meta.url),'utf8')!=='offline-data')throw Error('fixture');
    for(const path of ['/workspace/package.json',new URL('./fixture.txt',import.meta.url)]){
      let blocked=false;try{fs.writeFileSync(path,'changed')}catch{blocked=true}if(!blocked)throw Error('writable');
    }
    let blocked=false;try{await fetch('https://registry.npmjs.org',{signal:AbortSignal.timeout(1500)})}catch{blocked=true}if(!blocked)throw Error('network');
  }`,
    ],
  ];
  for (const image of report.images)
    for (const [name, source] of scenarios) {
      const input = bundle(source, name === "timeout" ? 500 : 10000);
      const result = await runAssertion(
        workspace,
        join(state, "jobs"),
        image,
        input,
        AbortSignal.timeout(30000),
      );
      assert.equal(result.revisionDigest, assertionDigest(input));
      const cell = classifyAssertion(image.profileId, null, result);
      if (name === "pass" || name === "isolation")
        assert.equal(assertionPassed(result), true, JSON.stringify(result));
      else if (name === "fail") assert.equal(cell.outcome, "fail", JSON.stringify(result));
      else {
        assert.equal(assertionPassed(result), false);
        assert.equal(cell.evidenceLevel, "static_only");
      }
      if (name === "timeout")
        assert.equal(result.session.stopReason, "entry_timeout", JSON.stringify(result));
      process.stdout.write(`${image.profileId}: ${name} qualified\n`);
    }
  process.stdout.write(
    "CI archive identity, caller provenance, scripts disabled, private/traversal archive rejection, safe symlink handling and symlink input rejection: qualified\n",
  );
} finally {
  await recoverResources(state);
  await collectSnapshots(state, new Set(), 0);
  await rm(base, { recursive: true, force: true });
}
