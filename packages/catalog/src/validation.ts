import { parseBoundedJson } from "@compatlab/contracts";
import {
  artifactIntegrity,
  assertPackageName,
  isDistTag,
  isExactVersion,
  type ResolvedArtifact,
  registryTarballUrl,
} from "@compatlab/engine";
import { z } from "zod";

export const revisionSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const adminActionSchema = z.strictObject({
  actor: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(1024),
});
export type AdminAction = z.infer<typeof adminActionSchema>;
export const lookupSchema = z.strictObject({
  artifactId: uuidSchema,
  matrixId: uuidSchema,
  classifierRevision: revisionSchema,
});
export type ReportLookup = z.infer<typeof lookupSchema>;

export function validateArtifact(artifact: ResolvedArtifact) {
  assertPackageName(artifact.name);
  if (!isExactVersion(artifact.version))
    throw new TypeError("Catalog admission requires an exact version.");
  const bytes = Buffer.from(JSON.stringify(artifact.manifest));
  const manifest = z.record(z.string(), z.unknown()).parse(parseBoundedJson(bytes, 2 * 1024 ** 2));
  const observedTags = z
    .record(z.string().refine(isDistTag), z.string().refine(isExactVersion))
    .parse(parseBoundedJson(Buffer.from(JSON.stringify(artifact.observedTags)), 64 * 1024));
  return {
    name: artifact.name,
    version: artifact.version,
    integrity: artifactIntegrity(artifact.integrity),
    tarballUrl: registryTarballUrl(artifact.tarballUrl),
    manifest,
    observedTags,
  };
}
