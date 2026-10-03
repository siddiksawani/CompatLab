import { z } from "zod";
import { probeModeSchema } from "./harness.js";
import { localReportSchema } from "./local-report.js";
import { probePlanSchema } from "./plan.js";
import { stopReasonSchema } from "./probes.js";
import { runtimeMatrixSchema } from "./runtime.js";
import { compatibilityOutcomeSchema } from "./vocabulary.js";

export const CLASSIFIER_REVISION = "classifier_v1";
export const failureClassificationSchema = z.enum([
  "package_not_found",
  "package_version_not_found",
  "registry_unavailable",
  "artifact_download_failed",
  "artifact_integrity_mismatch",
  "artifact_integrity_unavailable",
  "archive_rejected",
  "package_manifest_invalid",
  "declared_platform_unsupported",
  "dependency_source_unsupported",
  "dependency_install_failed",
  "install_script_required",
  "native_compilation_required",
  "preparation_limit_exceeded",
  "package_resolution_failed",
  "esm_import_failed",
  "commonjs_require_failed",
  "export_path_failed",
  "unsupported_builtin",
  "unsupported_runtime_api",
  "native_addon_load_failed",
  "unexpected_process_exit",
  "unclassified_runtime_failure",
  "sandbox_policy_limited",
  "process_timeout",
  "process_out_of_memory",
  "process_limit_exceeded",
  "output_limit_exceeded",
  "temporary_disk_limit_exceeded",
  "coverage_limit_exceeded",
  "sandbox_start_failed",
  "runner_unavailable",
  "runtime_image_unavailable",
  "harness_protocol_error",
  "result_submission_failed",
  "control_plane_error",
  "job_cancelled",
  "service_policy_rejected",
  "probe_assertion_failed",
]);
export const evidencePhaseSchema = z.enum([
  "resolution",
  "acquisition",
  "extraction",
  "preparation",
  "static_analysis",
  "sandbox_startup",
  "module_resolution",
  "module_evaluation",
  "probe_assertion",
  "teardown",
]);
export const normalizedFailureSchema = z.strictObject({
  classification: failureClassificationSchema,
  phase: evidencePhaseSchema,
  origin: z.enum(["package", "prerequisite", "policy", "infrastructure"]),
  retryable: z.boolean(),
  source: z.enum([
    "captured_error_code",
    "harness_observation",
    "supervisor",
    "preparation",
    "control",
  ]),
  message: z.string().max(1024),
});
export type NormalizedFailure = z.infer<typeof normalizedFailureSchema>;
export type FailureClassification = z.infer<typeof failureClassificationSchema>;
const count = z.number().int().nonnegative().max(512);
export const reportCoverageSchema = z.strictObject({
  planned: count.nullable(),
  observed: count,
  passed: count,
  failed: count,
  interrupted: count,
  untested: count.nullable(),
  complete: z.boolean(),
});
export const reportCellSchema = z.strictObject({
  runId: z.uuid().nullable(),
  profileId: z.string().max(64),
  group: z.enum(["root", "subpaths"]),
  mode: probeModeSchema,
  method: z.enum(["fresh_root_v2", "sequential_batch_v2"]),
  outcome: compatibilityOutcomeSchema,
  evidenceLevel: z.enum(["static_only", "smoke_tested"]),
  coverage: reportCoverageSchema,
  durationMs: z.number().nonnegative(),
  failure: normalizedFailureSchema.nullable(),
  entries: z
    .array(
      z.strictObject({
        index: count,
        specifier: z.string().max(2304),
        outcome: compatibilityOutcomeSchema,
        durationMs: z.number().nonnegative().nullable(),
        resolvedTo: z.string().max(4096).nullable(),
        failure: normalizedFailureSchema.nullable(),
      }),
    )
    .max(512),
  sessions: z
    .array(
      z.strictObject({
        probeId: z.uuid(),
        startIndex: count,
        stopReason: stopReasonSchema,
        exitCode: z.number().int().nullable(),
        oomKilled: z.boolean(),
        durationMs: z.number().nonnegative(),
      }),
    )
    .max(4),
});
export type ReportCell = z.infer<typeof reportCellSchema>;
export const hostedReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  scanId: z.uuid(),
  classifierRevision: z.string().min(1).max(128),
  observedAt: z.iso.datetime(),
  classifiedAt: z.iso.datetime(),
  artifact: localReportSchema.shape.artifact,
  preparation: z.strictObject({
    id: z.uuid(),
    outcome: compatibilityOutcomeSchema,
    failure: normalizedFailureSchema.nullable(),
    profileRevision: z.string().max(128),
    snapshot: localReportSchema.shape.snapshot.nullable(),
    installedCount: z.number().int().nonnegative(),
    omittedOptionalCount: z.number().int().nonnegative(),
    staticObservations: z.record(z.string(), z.unknown()),
  }),
  matrix: z.strictObject({
    id: z.uuid(),
    revision: z.string().max(128),
    platform: z.literal("linux_amd64_glibc"),
    harnessRevision: z.string().max(128),
    planRevision: z.string().max(128),
    policyRevision: z.string().max(128),
    images: runtimeMatrixSchema,
  }),
  omissions: probePlanSchema.shape.omissions.nullable(),
  outcome: compatibilityOutcomeSchema,
  evidenceLevel: z.enum(["static_only", "smoke_tested"]),
  coverageComplete: z.boolean(),
  cells: z.array(reportCellSchema).min(4).max(64),
  limitations: z.array(z.string().max(512)).max(16),
});
export type HostedReport = z.infer<typeof hostedReportSchema>;
