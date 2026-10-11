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
type Coverage = HostedReport["cells"][number]["coverage"];
export function isolationCounts({
  isolationPassed = 0,
  isolationUnconfirmed = 0,
}: Pick<Coverage, "isolationPassed" | "isolationUnconfirmed">) {
  return [
    ...(isolationPassed ? [`${isolationPassed} failed only in the shared batch`] : []),
    ...(isolationUnconfirmed
      ? [
          isolationUnconfirmed === 1
            ? "1 batch failure unconfirmed"
            : `${isolationUnconfirmed} batch failures unconfirmed`,
        ]
      : []),
  ];
}
export function isolationLimited({ coverage }: { coverage: Coverage }) {
  return (coverage.isolationPassed ?? 0) + (coverage.isolationUnconfirmed ?? 0) > 0;
}
export function coverageSummary(coverage: Coverage) {
  const limited = coverage.prerequisiteLimited ?? 0;
  const explained =
    limited + (coverage.isolationPassed ?? 0) + (coverage.isolationUnconfirmed ?? 0);
  const counts = [`${coverage.passed} passed`];
  if (!explained || coverage.failed > explained)
    counts.push(`${coverage.failed - explained} failed`);
  if (limited)
    counts.push(limited === 1 ? "1 needs an optional peer" : `${limited} need optional peers`);
  counts.push(...isolationCounts(coverage));
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
export function packageEvidencePath(name: string, version: string) {
  const parts = [...name.split("/"), version].map((part) =>
    encodeURIComponent(part).replace(/^%40/, "@"),
  );
  return `/npm/${parts.join("/")}`;
}
export const readError = (status: number) =>
  status === 404
    ? "This package or version is unavailable from the registry."
    : status === 400
      ? "Enter a valid npm package name and exact version."
      : "The service is temporarily unavailable. Please try again shortly.";
