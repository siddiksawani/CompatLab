export type RegistryClassification =
  | "package_not_found"
  | "package_version_not_found"
  | "registry_unavailable"
  | "package_manifest_invalid"
  | "artifact_integrity_unavailable"
  | "dependency_source_unsupported"
  | "preparation_limit_exceeded";

export class RegistryError extends Error {
  override readonly name = "RegistryError";

  constructor(
    readonly classification: RegistryClassification,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
