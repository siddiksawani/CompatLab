import { z } from "zod";

export const evidenceLevelSchema = z.enum(["static_only", "smoke_tested", "probe_verified"]);

export const compatibilityOutcomeSchema = z.enum([
  "pass",
  "partial",
  "fail",
  "inconclusive",
  "unsupported",
  "not_applicable",
  "infrastructure_error",
]);

export const scanStateSchema = z.enum([
  "requested",
  "preparing",
  "running",
  "aggregating",
  "completed",
  "inconclusive",
  "failed_infrastructure",
  "rejected",
  "cancelled",
]);

export const jobStateSchema = z.enum(["queued", "leased", "running", "finished"]);

export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type CompatibilityOutcome = z.infer<typeof compatibilityOutcomeSchema>;
export type ScanState = z.infer<typeof scanStateSchema>;
export type JobState = z.infer<typeof jobStateSchema>;
