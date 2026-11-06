import { findPackageReport } from "@compatlab/catalog/web";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { cache } from "react";
import { createReadQueue } from "./read-queue";
import { publicRead, webRuntime } from "./runtime";

async function loadPackageEvidence(name: string, version: string) {
  const { catalog, config } = webRuntime();
  const available = await findPackageReport(catalog.db, config.matrixId, name, version);
  if (!available) return null;
  const response = await publicRead(`/api/v1/reports/${available.id}/summary`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Package evidence unavailable.");
  const envelope = reportSummaryEnvelopeSchema.parse(await response.json());
  return envelope.status.current ? { ...envelope, available } : null;
}
const read = createReadQueue<Awaited<ReturnType<typeof loadPackageEvidence>>>();
export const packageEvidence = cache((name: string, version: string) =>
  read(JSON.stringify([name, version]), () => loadPackageEvidence(name, version)),
);
