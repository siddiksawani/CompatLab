import { createHash } from "node:crypto";
import {
  COMPARISON_REVISION,
  type HostedReport,
  type ReportCell,
  type ReportComparison,
  reportComparisonSchema,
} from "@compatlab/contracts";
import { compare, satisfies, validRange } from "semver";
export function matchingVersions(versions: readonly string[], range: string) {
  if (range.length > 256 || !validRange(range))
    throw new TypeError("Use a valid semantic version range.");
  const matching = [...new Set(versions)].filter((v) => satisfies(v, range)).sort(compare);
  if (matching.length > 5000)
    throw new TypeError("The range exceeds the 5000-version monitoring limit.");
  return matching;
}
export function earlierVersion(before: string, after: string) {
  return compare(before, after) < 0;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function failure(value: ReportCell["failure"]) {
  return value
    ? { classification: value.classification, phase: value.phase, origin: value.origin }
    : null;
}
function summary(cell: ReportCell) {
  return {
    outcome: cell.outcome,
    evidence: cell.evidenceLevel,
    coverage: cell.coverage,
    failure: failure(cell.failure),
  };
}
export function compareReports(before: HostedReport, after: HostedReport): ReportComparison {
  if (before.artifact.name !== after.artifact.name)
    throw new TypeError("Compare reports for the same package.");
  const result: ReportComparison = {
    schemaVersion: 1,
    revision: COMPARISON_REVISION,
    beforeReportId: before.id,
    afterReportId: after.id,
    packageName: before.artifact.name,
    beforeVersion: before.artifact.version,
    afterVersion: after.artifact.version,
    comparable:
      before.outcome !== "infrastructure_error" && after.outcome !== "infrastructure_error",
    changed: false,
    regression: false,
    totalChanges: 0,
    changesTruncated: false,
    changes: [],
    inputs: [],
    limitations: [
      "Changed inputs do not establish that a package change caused a result.",
      "Timing, timestamps, logs and free-text error messages do not trigger alerts.",
      "Comparisons do not establish general functional correctness or package safety.",
      "Only identical named assertion revisions are compared as behavior; changed revisions are disclosed as inputs.",
    ],
  };
  const add = (subject: string, a: unknown, b: unknown, regression = false) => {
    const left = JSON.stringify(a),
      right = JSON.stringify(b);
    if (left === right) return;
    result.totalChanges++;
    result.regression ||= regression;
    result.changed = true;
    if (result.changes.length < 256)
      result.changes.push({
        subject,
        before: left.slice(0, 2048),
        after: right.slice(0, 2048),
        regression,
      });
  };
  add(
    "Preparation",
    { outcome: before.preparation.outcome, failure: failure(before.preparation.failure) },
    { outcome: after.preparation.outcome, failure: failure(after.preparation.failure) },
    before.preparation.outcome === "pass" &&
      after.preparation.outcome !== "pass" &&
      after.preparation.failure?.origin !== "infrastructure",
  );
  const key = (cell: ReportCell) => `${cell.profileId}/${cell.group}/${cell.mode}`;
  const oldCells = new Map(before.cells.map((c) => [key(c), c])),
    newCells = new Map(after.cells.map((c) => [key(c), c]));
  for (const id of new Set([...oldCells.keys(), ...newCells.keys()])) {
    const a = oldCells.get(id),
      b = newCells.get(id);
    add(
      id,
      a ? summary(a) : null,
      b ? summary(b) : null,
      !!a &&
        !!b &&
        a.outcome === "pass" &&
        !["pass", "not_applicable", "infrastructure_error"].includes(b.outcome),
    );
    const oldEntries = new Map(a?.entries.map((e) => [e.specifier, e]) ?? []),
      newEntries = new Map(b?.entries.map((e) => [e.specifier, e]) ?? []);
    for (const entry of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
      const left = oldEntries.get(entry),
        right = newEntries.get(entry);
      add(
        `${id}: ${entry}`,
        left ? { outcome: left.outcome, failure: failure(left.failure) } : null,
        right ? { outcome: right.outcome, failure: failure(right.failure) } : null,
        !!left && !!right && left.outcome === "pass" && right.outcome === "fail",
      );
    }
  }
  for (const left of before.assertions ?? []) {
    const right = after.assertions?.find(
      (item) => item.definition.digest === left.definition.digest,
    );
    if (!right) continue;
    for (const a of left.cells) {
      const b = right.cells.find((cell) => cell.profileId === a.profileId);
      if (b)
        add(
          `Assertion ${left.definition.manifest.name}/${a.profileId}`,
          { outcome: a.outcome, failure: failure(a.failure) },
          { outcome: b.outcome, failure: failure(b.failure) },
          a.outcome === "pass" && b.outcome === "fail",
        );
    }
  }
  const inputs = (r: HostedReport) => ({
    artifact: r.artifact,
    maintainer_assertions: (r.assertions ?? []).map((a) => a.definition.digest),
    dependency_lock: r.preparation.snapshot?.lockDigest ?? null,
    snapshot: r.preparation.snapshot?.id ?? null,
    tree: r.preparation.snapshot?.treeDigest ?? null,
    preparation_profile: r.preparation.profileRevision,
    installer: r.preparation.snapshot?.installerImage ?? null,
    runtime_images: r.matrix.images.map((i) => ({ profile: i.profileId, digest: i.imageId })),
    harness: r.matrix.harnessRevision,
    probe: r.matrix.planRevision,
    policy: r.matrix.policyRevision,
    platform: r.matrix.platform,
    classifier: r.classifierRevision,
    batch_method: r.cells.map((c) => [key(c), c.method]),
    entry_order: digest(r.cells.map((c) => [key(c), c.entries.map((e) => e.specifier)])),
  });
  const a = inputs(before),
    b = inputs(after);
  for (const field of Object.keys(a) as (keyof typeof a)[])
    if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
      result.inputs.push({
        field,
        before: JSON.stringify(a[field]).slice(0, 4096),
        after: JSON.stringify(b[field]).slice(0, 4096),
      });
  result.changesTruncated = result.totalChanges > result.changes.length;
  result.regression &&= result.comparable;
  return reportComparisonSchema.parse(result);
}
