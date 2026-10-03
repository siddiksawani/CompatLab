import { z } from "zod";

export const PROBE_PLAN_REVISION = "explicit_exports_v1";
export const MAX_SUBPATHS = 512;
export const applicabilitySchema = z.discriminatedUnion("applicable", [
  z.strictObject({
    applicable: z.literal(true),
    reason: z.enum(["public_target", "resolution_required"]),
    target: z.string().max(2048).optional(),
  }),
  z.strictObject({
    applicable: z.literal(false),
    reason: z.enum(["not_exported", "non_executable"]),
  }),
]);
export const plannedEntrySchema = z.strictObject({
  subpath: z.string().max(2048),
  specifier: z.string().max(2304),
  esm: applicabilitySchema,
  commonjs: applicabilitySchema,
});
export const omissionReasonSchema = z.enum([
  "pattern",
  "non_executable",
  "not_exported",
  "invalid_subpath",
  "coverage_limit",
]);
export const runtimePlanSchema = z.strictObject({
  profileId: z.string().max(64),
  root: plannedEntrySchema,
  entries: z.array(plannedEntrySchema).max(MAX_SUBPATHS),
});
export const probePlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.literal(PROBE_PLAN_REVISION),
  name: z.string().max(214),
  version: z.string().max(256),
  runtimes: z.array(runtimePlanSchema).min(1).max(16),
  omissions: z.strictObject({
    counts: z.record(omissionReasonSchema, z.number().int().nonnegative()),
    samples: z
      .array(z.strictObject({ subpath: z.string().max(2048), reason: omissionReasonSchema }))
      .max(64),
  }),
});
export type Applicability = z.infer<typeof applicabilitySchema>;
export type PlannedEntry = z.infer<typeof plannedEntrySchema>;
export type ProbePlan = z.infer<typeof probePlanSchema>;
export type RuntimePlan = z.infer<typeof runtimePlanSchema>;
export type OmissionReason = z.infer<typeof omissionReasonSchema>;
