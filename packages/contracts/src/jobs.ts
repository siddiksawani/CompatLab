import { z } from "zod";
import { localReportSchema } from "./local-report.js";
import { type ProbePlan, probePlanSchema } from "./plan.js";
import { probeGroupResultSchema } from "./probes.js";
import { runtimeImageSchema } from "./runtime.js";
export const preparationClassificationSchema = z.enum([
  "dependency_source_unsupported",
  "artifact_integrity_mismatch",
  "artifact_integrity_unavailable",
  "package_manifest_invalid",
  "archive_rejected",
  "dependency_install_failed",
  "preparation_limit_exceeded",
  "declared_platform_unsupported",
  "install_script_required",
  "native_compilation_required",
]);

export const workerCapabilitiesSchema = z.strictObject({
  platform: z.literal("linux_amd64_glibc"),
  preparationProfiles: z.array(z.string().min(1).max(128)).min(1).max(16),
  imageDigests: z
    .array(z.string().regex(/^sha256:[a-f0-9]{64}$/))
    .min(1)
    .max(16),
  harnessRevision: z.literal("load_v2"),
  planRevision: z.literal("explicit_exports_v1"),
  policyRevision: z.literal("runtime_limits_v2"),
});
export const workerSessionSchema = z.strictObject({ sessionId: z.uuid() });
export const attemptSchema = workerSessionSchema.extend({
  jobId: z.uuid(),
  attemptToken: z.uuid(),
});
export const leaseSchema = z.strictObject({
  remainingMs: z.number().int().min(1).max(30_000),
  scanRemainingMs: z.number().int().min(1).max(900_000),
});
const assignment = {
  schemaVersion: z.literal(1),
  jobId: z.uuid(),
  scanId: z.uuid(),
  preparationId: z.uuid(),
  attemptToken: z.uuid(),
  attempt: z.number().int().min(1).max(3),
  lease: leaseSchema,
  artifact: localReportSchema.shape.artifact,
};
export const jobAssignmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...assignment,
    kind: z.literal("preparation"),
    profileRevision: z.string().min(1).max(128),
  }),
  z.strictObject({
    ...assignment,
    kind: z.literal("run"),
    snapshot: localReportSchema.shape.snapshot,
    image: runtimeImageSchema,
    plan: probePlanSchema,
    group: z.enum(["root", "subpaths"]),
    mode: z.enum(["esm", "commonjs"]),
    maxEvidenceBytes: z
      .number()
      .int()
      .min(1024)
      .max(20 * 1024 ** 2),
    maxLogBytes: z
      .number()
      .int()
      .nonnegative()
      .max(4 * 1024 ** 2),
  }),
]);
export const preparationResultSchema = z.strictObject({
  kind: z.literal("preparation"),
  snapshot: localReportSchema.shape.snapshot,
  lockBase64: z.string().min(4).max(22_369_624),
  manifestJson: z
    .string()
    .min(2)
    .max(2 * 1024 ** 2),
  staticObservations: z.record(z.string(), z.unknown()),
  installed: z.array(z.string().max(4096)).max(10_000),
  omittedOptional: z.array(z.string().max(4096)).max(10_000),
});
export const infrastructureFailureSchema = z.enum([
  "sandbox_start_failed",
  "runner_unavailable",
  "runtime_image_unavailable",
  "harness_protocol_error",
  "result_submission_failed",
  "control_plane_error",
]);
export const jobResultSchema = z.discriminatedUnion("kind", [
  preparationResultSchema,
  z.strictObject({ kind: z.literal("run"), evidence: probeGroupResultSchema }),
  z.strictObject({
    kind: z.literal("failure"),
    origin: z.enum(["preparation", "infrastructure"]),
    classification: z.union([preparationClassificationSchema, infrastructureFailureSchema]),
    message: z.string().max(2048),
  }),
]);
export const submissionSchema = attemptSchema.extend({ result: jobResultSchema });
export const claimResponseSchema = z.strictObject({
  job: jobAssignmentSchema.nullable(),
  snapshotIds: z.array(z.uuid()).max(128),
});
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>;
export type WorkerAttempt = z.infer<typeof attemptSchema>;
export type JobAssignment = z.infer<typeof jobAssignmentSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;
export type PreparationResult = z.infer<typeof preparationResultSchema>;

export function jobEvidenceBudget(plan: ProbePlan, metadata: unknown, runtimeCount: number) {
  const reserved = new TextEncoder().encode(JSON.stringify({ plan, metadata })).length + 1024 ** 2;
  const maxEvidenceBytes = Math.floor((20 * 1024 ** 2 - reserved) / (runtimeCount * 4));
  if (
    !Number.isInteger(runtimeCount) ||
    runtimeCount < 1 ||
    runtimeCount > 16 ||
    maxEvidenceBytes < 8192
  )
    throw new TypeError("The scan has insufficient evidence space.");
  return { maxEvidenceBytes, maxLogBytes: Math.floor((4 * 1024 ** 2) / (runtimeCount * 4)) };
}
