import type { CompatibilityOutcome, ReportSummary } from "@compatlab/contracts";
import { combineOutcomes } from "@compatlab/engine";
import { labels } from "../components/labels";

export type CompatibilityEvidence = Pick<ReportSummary, "id" | "coverageComplete"> & {
  artifact: Pick<ReportSummary["artifact"], "name" | "version">;
  matrix: {
    images: Pick<ReportSummary["matrix"]["images"][number], "kind" | "profileId" | "version">[];
  };
  preparation: Pick<ReportSummary["preparation"], "outcome">;
  cells: Pick<
    ReportSummary["cells"][number],
    "profileId" | "outcome" | "coverage" | "group" | "mode" | "failure"
  >[];
};

export const runtimeNames = { node: "Node.js", bun: "Bun", deno: "Deno" } as const;
const observations: Record<CompatibilityOutcome, string> = {
  pass: "passed the applicable loading checks",
  partial: "had mixed loading results",
  fail: "failed the applicable loading checks",
  inconclusive: "has inconclusive loading evidence",
  unsupported: "requires a workflow these checks do not support",
  not_applicable: "had no applicable loading checks",
  infrastructure_error: "could not be assessed because of a service error",
};

export function loadingCounts(cells: Pick<ReportSummary["cells"][number], "coverage">[]) {
  const passed = cells.reduce((sum, cell) => sum + cell.coverage.passed, 0);
  const peers = cells.reduce((sum, cell) => sum + (cell.coverage.prerequisiteLimited ?? 0), 0);
  const failed = cells.reduce((sum, cell) => sum + cell.coverage.failed, 0) - peers;
  const interrupted = cells.reduce((sum, cell) => sum + cell.coverage.interrupted, 0);
  const untested = cells.reduce((sum, cell) => sum + (cell.coverage.untested ?? 0), 0);
  return [
    `${passed} passed`,
    `${failed} failed`,
    ...(peers ? [peers === 1 ? "1 needs an optional peer" : `${peers} need optional peers`] : []),
    ...(interrupted ? [`${interrupted} interrupted`] : []),
    ...(untested ? [`${untested} untested`] : []),
  ].join(" · ");
}

export function runtimeAnswers(report: CompatibilityEvidence) {
  return (["node", "bun", "deno"] as const).flatMap((kind) => {
    const profiles = report.matrix.images.filter((image) => image.kind === kind);
    if (!profiles.length) return [];
    return [
      {
        kind,
        question: `Does ${report.artifact.name} work with ${runtimeNames[kind]}?`,
        results: profiles.map((image) => {
          const cells = report.cells.filter((cell) => cell.profileId === image.profileId);
          const outcome = cells.length
            ? combineOutcomes(cells.map((cell) => cell.outcome))
            : "inconclusive";
          return {
            profileId: image.profileId,
            runtime: `${runtimeNames[kind]} ${image.version}`,
            outcome,
            answer: `${report.artifact.name}@${report.artifact.version} ${observations[outcome]} in ${runtimeNames[kind]} ${image.version}.`,
            counts: loadingCounts(cells),
            failures: cells
              .filter((cell) => cell.failure)
              .map((cell) => ({
                label: `${cell.group === "root" ? "Root" : "Subpath"} ${cell.mode === "esm" ? "import" : "require"}: ${cell.failure?.classification.replaceAll("_", " ")}`,
                path: `/reports/${report.id}#${cell.profileId}-${cell.group}-${cell.mode}`,
              })),
          };
        }),
      },
    ];
  });
}

export function compatibilityDescription(report: CompatibilityEvidence) {
  const results = runtimeAnswers(report).flatMap(({ results }) => results);
  return `${report.artifact.name}@${report.artifact.version} loading tests: ${results.map((result) => `${result.runtime}: ${labels[result.outcome].toLowerCase()}`).join("; ")}. ${report.coverageComplete ? "Loading only, not functional correctness." : "Coverage is limited; not a full compatibility verdict."}`;
}

export function compatibilityScope(report: CompatibilityEvidence) {
  return [
    report.coverageComplete
      ? "All applicable planned loading checks completed."
      : "Coverage is limited: some exports or checks were omitted, incomplete or unavailable. A passing runtime row does not remove those gaps.",
    report.preparation.outcome !== "pass"
      ? `Shared preparation: ${labels[report.preparation.outcome].toLowerCase()}. Runtime support cannot be inferred from a preparation problem.`
      : "The runtimes used the same installed dependency snapshot.",
    "Test environment: Linux amd64 / glibc, with install scripts and execution networking disabled. Successful import or require does not prove that package functions, native features or your application work.",
  ].join(" ");
}
