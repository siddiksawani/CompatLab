import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkPackage,
  collectSnapshots,
  recoverResources,
  reproduceReport,
} from "../services/worker/dist/index.js";

if (process.geteuid?.() !== 0 || process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Rebuild qualification requires a fresh qualified Linux amd64 host.");
const directory = await mkdtemp(join(tmpdir(), "compatlab-rebuild-")),
  original = join(directory, "original"),
  rebuilt = join(directory, "rebuilt");
const started = performance.now();
try {
  const report = await checkPackage("is-number@7.0.0", { stateDirectory: original });
  const input = join(directory, "reproduction.json"),
    lock = join(directory, "package-lock.json");
  await writeFile(
    input,
    JSON.stringify({
      schemaVersion: 1,
      kind: "reproduction_inputs",
      reportId: report.id,
      artifact: report.artifact,
      snapshot: report.snapshot,
      images: report.images,
      harnessRevision: report.harnessRevision,
      policyRevision: report.policyRevision,
    }),
  );
  await writeFile(
    lock,
    await readFile(join(original, "locks", `${report.snapshot.lockDigest}.json`)),
  );
  await recoverResources(original);
  await collectSnapshots(original, new Set(), 0);
  await rm(original, { recursive: true, force: true });
  await assert.rejects(
    () => reproduceReport(input, { stateDirectory: rebuilt, rebuild: false }),
    "Missing snapshot must not silently rebuild.",
  );
  const restored = await reproduceReport(input, {
    stateDirectory: rebuilt,
    rebuild: true,
    lockFile: lock,
  });
  assert.equal(restored.reproduction.method, "rebuilt_from_lock");
  assert.notEqual(restored.snapshot.generation, report.snapshot.generation);
  assert.equal(restored.snapshot.lockDigest, report.snapshot.lockDigest);
  assert.deepEqual(restored.images, report.images);
  const roots = restored.groups.filter((group) => group.group === "root");
  assert.equal(roots.length, 8);
  assert.ok(roots.every((group) => group.observations.length === 1));
  assert.ok(
    restored.groups.every(
      (group) =>
        group.coverage.complete && group.observations.every((entry) => entry.outcome === "pass"),
    ),
  );
  process.stdout.write(
    `${JSON.stringify({ qualified: true, elapsedMs: Math.round(performance.now() - started), method: restored.reproduction.method, groups: restored.groups.length, snapshotGenerationChanged: true })}\n`,
  );
} finally {
  for (const path of [original, rebuilt]) {
    await recoverResources(path);
    await collectSnapshots(path, new Set(), 0);
  }
  await rm(directory, { recursive: true, force: true });
}
