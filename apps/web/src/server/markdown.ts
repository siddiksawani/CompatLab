import type { ReportPreview } from "@compatlab/catalog/web";
import type { ReportEnvelope, SearchResponse } from "@compatlab/contracts";
import { coverageSummary, labels } from "../components/labels";
import { compatibilityArticle } from "../content/articles";

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
    ...(search
      ? [
          "## Search results",
          ...search.packages.map(
            (item) =>
              `- ${text(item.name)} ${text(item.version)}: [package](${origin}/packages?${new URLSearchParams({ name: item.name })})${item.reportId ? `; [report](${origin}/reports/${item.reportId})` : "; no current report"}.`,
          ),
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
    `## Preparation\n\n${labels[report.preparation.outcome]}. Lifecycle scripts disabled. ${report.preparation.installedCount} installed packages; ${report.preparation.omittedOptionalCount} optional dependencies omitted.`,
    ...(report.preparation.failure
      ? [
          `Failure: ${text(report.preparation.failure.classification)}; ${text(report.preparation.failure.message)}`,
        ]
      : []),
    `## Runtime matrix\n\n${matrix(report)}`,
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
