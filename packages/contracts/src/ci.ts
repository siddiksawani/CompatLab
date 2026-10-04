import { z } from "zod";
import { localReportSchema } from "./local-report.js";
export const ciProvenanceSchema = z.strictObject({
  provider: z.literal("github_actions"),
  confidence: z.literal("caller_supplied"),
  repository: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  workflow: z.string().regex(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/),
  runId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  runAttempt: z.number().int().min(1).max(10000),
});
export const ciArtifactSchema = z.strictObject({
  kind: z.literal("ci_artifact"),
  name: z.string().min(1).max(214),
  version: z.string().min(1).max(256),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(32 * 1024 ** 2),
  provenance: ciProvenanceSchema,
});
export const ciReportSchema = localReportSchema
  .omit({ artifact: true, assertion: true })
  .extend({ artifact: ciArtifactSchema });
export type CiArtifact = z.infer<typeof ciArtifactSchema>;
export type CiReport = z.infer<typeof ciReportSchema>;
