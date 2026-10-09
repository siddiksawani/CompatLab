import type { ReportPreview } from "@compatlab/catalog/web";
import type { ReportEnvelope, SearchResponse } from "@compatlab/contracts";
import { coverageSummary, labels } from "../components/labels";
import { compatibilityArticle } from "../content/articles";
import { compatibilityScope, runtimeAnswers } from "./compatibility-copy";

function text(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_[\]{}()<>#+.!|~-]/g, "\\$&");
}

function matrix(report: Pick<ReportPreview, "matrix" | "cells">) {
  return report.matrix.images
    .map((image) =>
      [
        `### ${text(image.kind)} ${text(image.version)}`,
        `Profile: ${text(image.profileId)}. Image: ${text(image.imageId)}.`,
        ...report.cells
          .filter((cell) => cell.profileId === image.profileId)
          .map(
            (cell) =>
              `- ${cell.group} ${cell.mode}: ${labels[cell.outcome]}; ${coverageSummary(cell.coverage)}.`,
          ),
      ].join("\n\n"),
    )
    .join("\n\n");
}

export function homeMarkdown(origin: string, reports: ReportPreview[], search?: SearchResponse) {
  return [
    "# CompatLab",
    "Check whether an npm package loads with import and require in Node.js, Bun and Deno.",
    "Published npm packages are tested on Linux amd64 / glibc with pinned runtime images. Install scripts stay disabled. Loading success does not establish functional correctness or package safety.",
    `Search by name at ${origin}/ or read the [public API guide](${origin}/api). Reads never start scans.`,
    `[Browse npm compatibility results](${origin}/npm/compatibility) · [Observed runtime loading failures](${origin}/npm/compatibility/failures)`,
    ...(search
      ? [
          "## Search results",
          ...search.packages.map((item) => {
            const query = new URLSearchParams({ name: item.name, version: item.version });
            const evidence = item.reportId
              ? `[report](${origin}/reports/${item.reportId})`
              : item.availableReport
                ? `[earlier environment report](${origin}/reports/${item.availableReport.id}); no report for the current environment`
                : "no eligible report available";
            return `- ${text(item.name)} ${text(item.version)}: [package](${origin}/packages?${query}); ${evidence}.`;
          }),
        ]
      : []),
    "## Completed reports",
    ...reports.map(
      (report) =>
        `- [${text(report.artifact.name)} ${text(report.artifact.version)}](${origin}/reports/${report.id}): ${labels[report.outcome]}; ${report.coverageComplete ? "planned coverage complete" : "coverage limited"}.`,
    ),
    ...(reports[0]
      ? ["## Example runtime results", matrix(reports[0])]
      : ["No completed reports are currently available."]),
    `## From the lab\n\n[${compatibilityArticle.title}](${origin}${compatibilityArticle.path})\n\n${compatibilityArticle.description}`,
    `[Methodology](${origin}/methodology) · [Privacy and removal](${origin}/privacy) · [Source](https://github.com/siddiksawani/CompatLab)`,
    "",
  ].join("\n\n");
}

export function reportMarkdown(origin: string, { report, status }: ReportEnvelope) {
  const api = `${origin}/api/v1/reports/${report.id}`;
  return [
    `# ${text(report.artifact.name)} ${text(report.artifact.version)}`,
    `Report: ${origin}/reports/${report.id}`,
    status.current
      ? "Status: current evidence."
      : `Status: historical evidence. ${text(status.invalidationReason ?? "This report is superseded or unavailable under the current policy.")}${status.replacedBy ? ` Replacement: ${origin}/reports/${status.replacedBy}` : ""}`,
    `Outcome: ${labels[report.outcome]}. ${report.coverageComplete ? "Planned coverage complete." : "Coverage is limited."}`,
    `Observed: ${report.observedAt ?? "not retained"}. Platform: Linux amd64 / glibc. Evidence: ${report.evidenceLevel}.`,
    "Loading success does not establish functional correctness or package safety. These are observations of specific inputs, not a general compatibility guarantee.",
    "## Compatibility questions",
    text(compatibilityScope(report)),
    ...runtimeAnswers(report).flatMap(({ question, results }) => [
      `### ${text(question)}`,
      ...results.flatMap((result) => [
        `${text(result.answer)} ${text(result.counts)}.`,
        ...result.failures.map((failure) => `- [${text(failure.label)}](${origin}${failure.path})`),
      ]),
    ]),
    `[Compare npm package compatibility across Node.js, Bun and Deno](${origin}/npm/compatibility) · [Observed runtime loading failures](${origin}/npm/compatibility/failures)`,
    `## Preparation\n\n${labels[report.preparation.outcome]}. Lifecycle scripts disabled. ${report.preparation.installedCount} installed packages; ${report.preparation.omittedOptionalCount} optional dependencies omitted.`,
    ...(report.preparation.failure
      ? [
          `Failure: ${text(report.preparation.failure.classification)}; ${text(report.preparation.failure.message)}`,
        ]
      : []),
    `## Runtime matrix\n\n${matrix(report)}`,
    ...(report.cells.some((cell) => (cell.coverage.prerequisiteLimited ?? 0) > 0)
      ? [
          "Some checks require optional peers absent from the tested snapshot. Their runtime compatibility is inconclusive. Failed loading observations are retained; adding a peer requires a separate test and does not imply success.",
        ]
      : []),
    "Root modes use fresh sandboxes. Subpath batches share module caches and globals. Passed and failed counts are separate from planned coverage.",
    "## Failures",
    ...report.cells
      .filter((cell) => cell.failure)
      .map(
        (cell) =>
          `- ${text(cell.profileId)} ${cell.group} ${cell.mode}: ${text(cell.failure?.classification ?? "")}; ${text(cell.failure?.message ?? "")}. [Details](${origin}/reports/${report.id}#${cell.profileId}-${cell.group}-${cell.mode}).`,
      ),
    "## Provenance and retained evidence",
    `Matrix: ${text(report.matrix.revision)}. Harness: ${text(report.matrix.harnessRevision)}. Planner: ${text(report.matrix.planRevision)}. Policy: ${text(report.matrix.policyRevision)}. Classifier: ${text(report.classifierRevision)}.`,
    `Artifact integrity: ${text(report.artifact.integrity)}.`,
    `Snapshot available: ${status.snapshotAvailable ? "yes" : "no"}. Retention and a successful rebuild are not guaranteed.`,
    `This summary omits individual entry observations, raw logs and named assertions. [Full JSON with status](${api}) · [Report with coverage, assertions and reproduction inputs](${origin}/reports/${report.id})`,
    "## Limitations",
    ...report.limitations.map((limitation) => `- ${text(limitation)}`),
    `[Methodology](${origin}/methodology) · [Removal](${origin}/privacy#removal)`,
    "",
  ].join("\n\n");
}
