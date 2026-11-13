import type { CompatibilityOutcome, ReportSummary } from "@compatlab/contracts";

export type BadgeMode = "import" | "require";

const runtimeNames = { node: "Node", bun: "Bun", deno: "Deno" } as const;
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

export function loadingBadge(summary: ReportSummary, mode: BadgeMode) {
  if (!summary.observedAt || summary.preparation.outcome !== "pass")
    return badgePayload(mode, "no loading evidence");

  const selectedMode = mode === "import" ? "esm" : "commonjs";
  const roots = new Map(
    summary.cells
      .filter((cell) => cell.group === "root" && cell.mode === selectedMode)
      .map((cell) => [cell.profileId, cell.outcome]),
  );
  const outcomes = summary.matrix.images.map((image) => ({
    name: `${runtimeNames[image.kind]} ${image.version}`,
    outcome: roots.get(image.profileId) ?? "inconclusive",
  }));
  const applicable = outcomes.filter(({ outcome }) => outcome !== "not_applicable");
  const passed = applicable.filter(({ outcome }) => outcome === "pass").length;
  const color =
    passed === outcomes.length
      ? "green"
      : applicable.some(({ outcome }) => outcome === "fail" || outcome === "partial")
        ? "yellow"
        : "lightgrey";
  const message =
    outcomes.length <= 4
      ? outcomes.map(({ name, outcome }) => `${name} ${outcomeLabels[outcome]}`).join(" · ")
      : `${passed}/${applicable.length} applicable profiles passed · ${outcomes.length - applicable.length} N/A`;
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

export function badgeMarkdown(origin: string, reportId: string, mode: BadgeMode) {
  const endpoint = new URL(`/api/v1/badges/${reportId}`, origin);
  endpoint.searchParams.set("mode", mode);
  const shield = new URL("https://img.shields.io/endpoint");
  shield.searchParams.set("url", endpoint.href);
  const report = new URL(`/reports/${reportId}`, origin);
  return `[![CompatLab root ${mode}](${shield.href})](${report.href})`;
}
