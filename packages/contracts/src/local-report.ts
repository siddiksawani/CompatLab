import { z } from "zod";
import { probePlanSchema } from "./plan.js";
import { PROBE_HARNESS_REVISION, PROBE_POLICY_REVISION, probeGroupResultSchema } from "./probes.js";
import { runtimeMatrixSchema } from "./runtime.js";

export const localReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  evidenceLevel: z.enum(["static_only", "smoke_tested"]),
  harnessRevision: z.literal(PROBE_HARNESS_REVISION),
  policyRevision: z.literal(PROBE_POLICY_REVISION),
  artifact: z.strictObject({
    name: z.string().max(214),
    version: z.string().max(256),
    integrity: z.string().max(1024),
    tarballUrl: z.string().max(2048),
  }),
  snapshot: z.strictObject({
    id: z.uuid(),
    generation: z.uuid(),
    lockDigest: z.string().regex(/^[a-f0-9]{64}$/),
    treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
    profileRevision: z.string().max(64),
    installerImage: z.string().max(256),
  }),
  reproduction: z.strictObject({
    method: z.enum(["prepared", "verified_reuse", "rebuilt_from_lock"]),
    previousGeneration: z.uuid().nullable(),
  }),
  images: runtimeMatrixSchema,
  plan: probePlanSchema,
  staticObservations: z.record(z.string(), z.unknown()),
  groups: z.array(probeGroupResultSchema).max(64),
  deadlineReached: z.boolean(),
  cancelled: z.boolean(),
});
export type LocalReport = z.infer<typeof localReportSchema>;
