import { z } from "zod";
import { probeSessionSchema } from "./probes.js";
export const ASSERTION_HARNESS_REVISION = "assertion_v1";
export const assertionPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(
    (value) =>
      value.split("/").length <= 8 &&
      !value.split("/").some((part) => part === "." || part === ".." || part === "node_modules"),
  );
export const assertionCapabilitiesSchema = z.strictObject({
  network: z.literal("none"),
  filesystem: z.literal("read_only_workspace_and_bounded_temporary_output"),
  processes: z.literal("bounded"),
});
export const assertionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  packageName: z.string().min(1).max(214),
  packageRange: z.string().min(1).max(256),
  entry: assertionPathSchema.refine((path) => path.endsWith(".mjs")),
  timeoutMs: z.number().int().min(100).max(30000),
  capabilities: assertionCapabilitiesSchema,
  fixtures: z.array(assertionPathSchema).max(15),
  expectedBehavior: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => !value.includes("\u0000")),
});
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const assertionFileSchema = z.strictObject({
  path: assertionPathSchema,
  gitBlobSha: sha,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  base64: z.string().max(699052),
});
export const assertionBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  harnessRevision: z.literal(ASSERTION_HARNESS_REVISION),
  policyRevision: z.literal("runtime_limits_v2"),
  repository: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/),
  commit: sha,
  tree: sha,
  manifestPath: assertionPathSchema,
  manifest: assertionManifestSchema,
  files: z.array(assertionFileSchema).min(1).max(16),
});
export const assertionDefinitionSchema = assertionBundleSchema.omit({ files: true }).extend({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z
    .array(assertionFileSchema.omit({ base64: true }))
    .min(1)
    .max(16),
});
export const assertionEvidenceSchema = z.strictObject({
  revisionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  profileId: z.string().min(1).max(64),
  session: probeSessionSchema,
});
export type AssertionBundle = z.infer<typeof assertionBundleSchema>;
export type AssertionDefinition = z.infer<typeof assertionDefinitionSchema>;
export type AssertionEvidence = z.infer<typeof assertionEvidenceSchema>;
