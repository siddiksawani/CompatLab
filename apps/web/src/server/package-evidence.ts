import { findPackageReport } from "@compatlab/catalog/web";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { cache } from "react";
import { publicRead, webRuntime } from "./runtime";

let pending = 0;
export const packageEvidence = cache(async (name: string, version: string) => {
  if (pending >= 2) throw new Error("Package evidence is busy.");
  pending++;
  try {
    const { catalog, config } = webRuntime();
    const available = await findPackageReport(catalog.db, config.matrixId, name, version);
    if (!available) return null;
    const response = await publicRead(`/api/v1/reports/${available.id}/summary`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Package evidence unavailable.");
    const envelope = reportSummaryEnvelopeSchema.parse(await response.json());
    return envelope.status.current ? { ...envelope, available } : null;
  } finally {
    pending--;
  }
});
