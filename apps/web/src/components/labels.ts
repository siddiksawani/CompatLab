import type { CompatibilityOutcome, HostedReport } from "@compatlab/contracts";

export const labels: Record<CompatibilityOutcome, string> = {
  pass: "Passed",
  partial: "Mixed results",
  fail: "Failed",
  inconclusive: "Inconclusive",
  unsupported: "Unsupported workflow",
  not_applicable: "Not applicable",
  infrastructure_error: "Service error",
};
export function coverageSummary(coverage: HostedReport["cells"][number]["coverage"]) {
  const limited = coverage.prerequisiteLimited ?? 0;
  const counts = [`${coverage.passed} passed`];
  if (!limited || coverage.failed > limited) counts.push(`${coverage.failed - limited} failed`);
  if (limited)
    counts.push(limited === 1 ? "1 needs an optional peer" : `${limited} need optional peers`);
  if (coverage.interrupted) counts.push(`${coverage.interrupted} interrupted`);
  if (coverage.untested) counts.push(`${coverage.untested} untested`);
  if (!coverage.complete && !coverage.untested) counts.push("coverage limited");
  return counts.join(" · ");
}
export function observedDate(value: string | null) {
  return value
    ? `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "Time not retained";
}
export function packageUrl(name: string, version?: string) {
  const query = new URLSearchParams({ name, ...(version ? { version } : {}) });
  return `/packages?${query}`;
}
export const readError = (status: number) =>
  status === 404
    ? "This package or version is unavailable from the registry."
    : status === 400
      ? "Enter a valid npm package name and exact version."
      : "The service is temporarily unavailable. Please try again shortly.";
