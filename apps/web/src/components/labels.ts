import type { CompatibilityOutcome } from "@compatlab/contracts";

export const labels: Record<CompatibilityOutcome, string> = {
  pass: "Passed",
  partial: "Mixed results",
  fail: "Failed",
  inconclusive: "Inconclusive",
  unsupported: "Unsupported workflow",
  not_applicable: "Not applicable",
  infrastructure_error: "Service error",
};
export function observedDate(value: string | null) {
  return value
    ? `${new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value))} UTC`
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
