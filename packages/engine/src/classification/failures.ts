import {
  type FailureClassification,
  failureClassificationSchema,
  type LoadObservation,
  type NormalizedFailure,
  type ProbeMode,
  type StopReason,
} from "@compatlab/contracts";
import { sanitizeText } from "./text.js";

export function classifyLoad(
  observation: Extract<LoadObservation, { outcome: "fail" }>,
  mode: ProbeMode,
): NormalizedFailure {
  const codes: Record<string, FailureClassification> = {
    MODULE_NOT_FOUND: "package_resolution_failed",
    ERR_MODULE_NOT_FOUND: "package_resolution_failed",
    ERR_PACKAGE_PATH_NOT_EXPORTED: "export_path_failed",
    ERR_PACKAGE_IMPORT_NOT_DEFINED: "export_path_failed",
    ERR_UNKNOWN_BUILTIN_MODULE: "unsupported_builtin",
    ERR_DLOPEN_FAILED: "native_addon_load_failed",
    ERR_REQUIRE_ESM: "commonjs_require_failed",
    ERR_REQUIRE_ASYNC_MODULE: "commonjs_require_failed",
  };
  const captured =
    observation.error.code && Object.hasOwn(codes, observation.error.code)
      ? codes[observation.error.code]
      : undefined;
  const classification =
    captured || (mode === "esm" ? "esm_import_failed" : "commonjs_require_failed");
  return {
    classification,
    phase: ["package_resolution_failed", "export_path_failed", "unsupported_builtin"].includes(
      classification,
    )
      ? "module_resolution"
      : "module_evaluation",
    origin: "package",
    retryable: false,
    source: captured ? "captured_error_code" : "harness_observation",
    message: sanitizeText(observation.error.message).slice(0, 1024),
  };
}

export function classifyStop(reason: StopReason): NormalizedFailure {
  const classifications: Record<StopReason, FailureClassification> = {
    completed: "unclassified_runtime_failure",
    entry_timeout: "process_timeout",
    batch_timeout: "process_timeout",
    scan_deadline: "coverage_limit_exceeded",
    cancelled: "job_cancelled",
    output_limit_exceeded: "output_limit_exceeded",
    memory_limit_exceeded: "process_out_of_memory",
    sandbox_start_failed: "sandbox_start_failed",
    harness_protocol_error: "harness_protocol_error",
    unexpected_process_exit: "unexpected_process_exit",
  };
  const classification = classifications[reason];
  const infrastructure = reason === "sandbox_start_failed" || reason === "harness_protocol_error";
  return {
    classification,
    phase: reason === "sandbox_start_failed" ? "sandbox_startup" : "module_evaluation",
    origin: infrastructure ? "infrastructure" : "policy",
    retryable: infrastructure,
    source: "supervisor",
    message: `Execution stopped: ${reason.replaceAll("_", " ")}.`,
  };
}

export function classifyDiagnostic(
  value: unknown,
  fallback: FailureClassification = "runner_unavailable",
): NormalizedFailure {
  const record =
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const parsed = failureClassificationSchema.safeParse(record.classification);
  const classification = parsed.success ? parsed.data : fallback;
  const prerequisite = [
    "install_script_required",
    "native_compilation_required",
    "declared_platform_unsupported",
  ].includes(classification);
  const infrastructure =
    record.origin === "infrastructure" ||
    [
      "runner_unavailable",
      "sandbox_start_failed",
      "runtime_image_unavailable",
      "control_plane_error",
      "result_submission_failed",
      "harness_protocol_error",
    ].includes(classification);
  const control =
    classification === "job_cancelled" ||
    classification === "service_policy_rejected" ||
    classification === "coverage_limit_exceeded";
  const policy = control || classification === "preparation_limit_exceeded";
  const phase =
    record.phase === "static_analysis"
      ? "static_analysis"
      : infrastructure
        ? classification === "result_submission_failed"
          ? "teardown"
          : "sandbox_startup"
        : control
          ? "teardown"
          : classification.startsWith("artifact_")
            ? "acquisition"
            : classification === "archive_rejected"
              ? "extraction"
              : "preparation";
  return {
    classification,
    phase,
    origin: infrastructure
      ? "infrastructure"
      : prerequisite
        ? "prerequisite"
        : policy
          ? "policy"
          : "package",
    retryable: infrastructure,
    source: infrastructure || control ? "control" : "preparation",
    message: sanitizeText(
      typeof record.message === "string"
        ? record.message
        : `Observation unavailable: ${classification.replaceAll("_", " ")}.`,
    ).slice(0, 1024),
  };
}
