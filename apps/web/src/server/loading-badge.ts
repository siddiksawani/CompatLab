import type { CompatibilityOutcome, ReportSummary } from "@compatlab/contracts";

export type BadgeMode = "import" | "require";

const runtimeNames = { node: "Node", bun: "Bun", deno: "Deno" } as const;
const profilesPerBadge = 4;
const outcomeLabels: Record<CompatibilityOutcome, string> = {
  pass: "pass",
  partial: "mixed",
  fail: "fail",
  inconclusive: "unclear",
  unsupported: "unsupported",
  not_applicable: "N/A",
  infrastructure_error: "service error",
};

export function badgePayload(mode: BadgeMode, message: string, color = "lightgrey") {
  return { schemaVersion: 1, label: `root ${mode}`, message, color } as const;
}

export function badgeGroupCount({ matrix }: Pick<ReportSummary, "matrix">) {
  return Math.ceil(matrix.images.length / profilesPerBadge);
}

type BadgeEvidence = Pick<ReportSummary, "observedAt" | "matrix"> & {
  preparation: Pick<ReportSummary["preparation"], "outcome">;
  cells: Pick<ReportSummary["cells"][number], "profileId" | "group" | "mode" | "outcome">[];
};

export function loadingBadge(summary: BadgeEvidence, mode: BadgeMode, group = 1) {
  if (!summary.observedAt || summary.preparation.outcome !== "pass")
    return badgePayload(mode, "no loading evidence");

  const selectedMode = mode === "import" ? "esm" : "commonjs";
  const roots = new Map(
    summary.cells
      .filter((cell) => cell.group === "root" && cell.mode === selectedMode)
      .map((cell) => [cell.profileId, cell.outcome]),
  );
  const start = (group - 1) * profilesPerBadge;
  const outcomes = summary.matrix.images.slice(start, start + profilesPerBadge).map((image) => ({
    name: `${runtimeNames[image.kind]} ${image.version}`,
    outcome: roots.get(image.profileId) ?? "inconclusive",
  }));
  if (!outcomes.length) return badgePayload(mode, "no runtime profiles");
  const color = outcomes.every(({ outcome }) => outcome === "pass")
    ? "green"
    : outcomes.some(({ outcome }) => outcome === "fail" || outcome === "partial")
      ? "yellow"
      : "lightgrey";
  const message = outcomes
    .map(({ name, outcome }) => `${name} ${outcomeLabels[outcome]}`)
    .join(" · ");
  return badgePayload(mode, message, color);
}

export function badgeAvailable(summary: ReportSummary, mode: BadgeMode) {
  const selectedMode = mode === "import" ? "esm" : "commonjs";
  return (
    summary.observedAt !== null &&
    summary.preparation.outcome === "pass" &&
    summary.cells.some(
      (cell) => cell.group === "root" && cell.mode === selectedMode && cell.coverage.observed > 0,
    )
  );
}

export function badgeMarkdown(origin: string, reportId: string, mode: BadgeMode, group = 1) {
  const endpoint = new URL(`/api/v1/badges/${reportId}/shields`, origin);
  endpoint.searchParams.set("mode", mode);
  if (group > 1) endpoint.searchParams.set("group", String(group));
  const shield = new URL("https://img.shields.io/endpoint");
  shield.searchParams.set("url", endpoint.href);
  const report = new URL(`/reports/${reportId}`, origin);
  return `[![CompatLab root ${mode}](${shield.href})](${report.href})`;
}
