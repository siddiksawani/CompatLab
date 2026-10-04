import { createHash } from "node:crypto";
import {
  type AssertionBundle,
  type AssertionCell,
  type AssertionDefinition,
  type AssertionEvidence,
  assertionBundleSchema,
  type NormalizedFailure,
  parseProbeCheckpoint,
} from "@compatlab/contracts";
import { failureOutcome } from "./classification/cells.js";
import { classifyStop } from "./classification/failures.js";
import { sanitizeText } from "./classification/text.js";
import { matchingVersions } from "./comparison.js";
import { assertPackageName } from "./registry/validation.js";
export function validateAssertionBundle(raw: unknown): AssertionBundle {
  const bundle = assertionBundleSchema.parse(raw);
  assertPackageName(bundle.manifest.packageName);
  matchingVersions([], bundle.manifest.packageRange);
  const paths = [bundle.manifest.entry, ...bundle.manifest.fixtures].sort();
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, i) => paths.some((other, j) => i !== j && other.startsWith(`${path}/`)))
  )
    throw new TypeError("Assertion paths must be distinct regular files.");
  const files = [...bundle.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (JSON.stringify(files.map((file) => file.path)) !== JSON.stringify(paths))
    throw new TypeError("Assertion files differ from the manifest.");
  let total = 0;
  for (const file of files) {
    const bytes = Buffer.from(file.base64, "base64");
    total += bytes.length;
    if (
      bytes.toString("base64") !== file.base64 ||
      bytes.length > (file.path === bundle.manifest.entry ? 65536 : 524288) ||
      total > 2 * 1024 ** 2
    )
      throw new TypeError("Assertion file bounds exceeded.");
    if (
      createHash("sha256").update(bytes).digest("hex") !== file.sha256 ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !==
        file.gitBlobSha
    )
      throw new TypeError("Assertion file digest mismatch.");
    if (file.path === bundle.manifest.entry) new TextDecoder("utf8", { fatal: true }).decode(bytes);
  }
  return { ...bundle, files };
}
export function assertionDigest(raw: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(validateAssertionBundle(raw)))
    .digest("hex");
}
export function assertionDefinition(raw: unknown): AssertionDefinition {
  const bundle = validateAssertionBundle(raw);
  return {
    ...bundle,
    digest: assertionDigest(bundle),
    files: bundle.files.map(({ base64: _bytes, ...file }) => file),
  };
}
export function verifyAssertionEvidence(evidence: AssertionEvidence, packageName: string) {
  const s = evidence.session;
  if (s.startIndex !== 0) throw new TypeError("Invalid assertion session.");
  if (s.checkpoint)
    parseProbeCheckpoint(Buffer.from(JSON.stringify(s.checkpoint)), {
      schemaVersion: 2,
      probeId: s.probeId,
      mode: "esm",
      group: "root",
      entries: [packageName],
      startIndex: 0,
    });
  if (s.stopReason === "completed" && (s.exitCode !== 0 || s.oomKilled || !s.checkpoint?.completed))
    throw new TypeError("Assertion completion lacks a successful process outcome.");
}
export function assertionPassed(evidence: AssertionEvidence) {
  return (
    evidence.session.stopReason === "completed" &&
    evidence.session.exitCode === 0 &&
    !evidence.session.oomKilled &&
    evidence.session.checkpoint?.completed === true &&
    evidence.session.checkpoint.observations[0]?.outcome === "pass"
  );
}

export function classifyAssertion(
  profileId: string,
  runId: string | null,
  evidence: AssertionEvidence | null,
  unavailable: NormalizedFailure | null = null,
): AssertionCell {
  const session = evidence?.session,
    observed = session?.checkpoint?.observations[0];
  const completed =
    !!session &&
    session.stopReason === "completed" &&
    session.exitCode === 0 &&
    !session.oomKilled &&
    session.checkpoint?.completed === true &&
    !!observed;
  const failure: NormalizedFailure | null = completed
    ? observed?.outcome === "fail"
      ? {
          classification: "probe_assertion_failed",
          phase: "probe_assertion",
          origin: "package",
          retryable: false,
          source: "harness_observation",
          message: sanitizeText(observed.error.message).slice(0, 1024),
        }
      : null
    : session
      ? { ...classifyStop(session.stopReason), phase: "probe_assertion" }
      : unavailable;
  return {
    runId,
    profileId,
    classifierRevision: "assertion_classifier_v1",
    outcome: completed
      ? failure
        ? "fail"
        : "pass"
      : failure
        ? failureOutcome(failure)
        : "inconclusive",
    evidenceLevel: completed ? "probe_verified" : "static_only",
    durationMs: session?.durationMs ?? 0,
    failure,
  };
}
