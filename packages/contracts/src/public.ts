import { z } from "zod";
import { hostedReportSchema, normalizedFailureSchema, reportCellSchema } from "./report.js";
import { compatibilityOutcomeSchema, scanStateSchema } from "./vocabulary.js";

export const availableReportSchema = hostedReportSchema
  .pick({
    id: true,
    observedAt: true,
    classifierRevision: true,
    outcome: true,
    coverageComplete: true,
  })
  .extend({
    matchesCurrentMatrix: z.boolean(),
    matrix: hostedReportSchema.shape.matrix.pick({ id: true, revision: true, platform: true }),
  });

export const packageSummarySchema = z.object({
  name: z.string().max(214),
  version: z.string().max(256),
  description: z.string().max(4096).optional(),
  repositoryUrl: z.url().max(2048).optional(),
  reportId: z.uuid().nullable(),
  availableReport: availableReportSchema.nullable().optional(),
});
export const searchResponseSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.array(packageSummarySchema).max(20),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export const packageResponseSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  deprecated: z.string().nullable(),
  repositoryUrl: z.url().nullable(),
  versions: z.array(z.string()).max(200),
  versionsTruncated: z.boolean(),
  tags: z.record(z.string(), z.string()),
  reportId: z.uuid().nullable(),
  availableReport: availableReportSchema.nullable().optional(),
  scanId: z.uuid().nullable(),
  scansEnabled: z.boolean(),
});
export type PackageResponse = z.infer<typeof packageResponseSchema>;
export const scanProgressSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  state: scanStateSchema,
  revision: z.number().int(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  aggregationFailedAt: z.iso.datetime().nullable(),
  reportId: z.uuid().nullable(),
  jobs: z.object({
    queued: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    finished: z.number().int().nonnegative(),
  }),
});
export type ScanProgress = z.infer<typeof scanProgressSchema>;
export const reportEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.object({
    id: z.uuid(),
    scanId: z.uuid(),
    current: z.boolean(),
    policyAllowed: z.boolean(),
    snapshotAvailable: z.boolean(),
    createdAt: z.iso.datetime(),
    invalidatedAt: z.iso.datetime().nullable(),
    invalidationReason: z.string().nullable(),
    replacedBy: z.uuid().nullable(),
    observationRevision: z.number().int().nonnegative().optional(),
    previousScanId: z.uuid().nullable().optional(),
    previousReportId: z.uuid().nullable().optional(),
  }),
  report: hostedReportSchema,
});
export type ReportEnvelope = z.infer<typeof reportEnvelopeSchema>;
export const reportSummarySchema = hostedReportSchema
  .pick({
    id: true,
    scanId: true,
    artifact: true,
    observedAt: true,
    classifiedAt: true,
    classifierRevision: true,
    matrix: true,
    outcome: true,
    evidenceLevel: true,
    coverageComplete: true,
    limitations: true,
  })
  .extend({
    preparation: hostedReportSchema.shape.preparation.omit({ staticObservations: true }),
    cells: z
      .array(reportCellSchema.omit({ entries: true, sessions: true }))
      .min(4)
      .max(64),
    runtimes: z
      .array(
        z.strictObject({
          profileId: z.string().max(64),
          outcome: compatibilityOutcomeSchema,
        }),
      )
      .min(1)
      .max(16),
    missingOptionalPeers: z.array(normalizedFailureSchema.shape.optionalPeer.unwrap()).max(16),
    missingOptionalPeersTruncated: z.boolean(),
  });
export const reportSummaryEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  reportPath: z.string().regex(/^\/reports\/[a-f0-9-]{36}$/),
  status: reportEnvelopeSchema.shape.status,
  summary: reportSummarySchema,
});
export type ReportSummaryEnvelope = z.infer<typeof reportSummaryEnvelopeSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export const admissionRequestSchema = z.strictObject({
  name: z.string().min(1).max(214),
  version: z.string().min(1).max(256),
});
export const admissionResponseSchema = z.union([
  z.object({ kind: z.literal("cached"), reportId: z.uuid(), scanId: z.uuid() }),
  z.object({ kind: z.enum(["existing", "admitted"]), scanId: z.uuid(), preparationId: z.uuid() }),
]);
