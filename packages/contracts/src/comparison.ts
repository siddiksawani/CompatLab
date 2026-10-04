import { z } from "zod";
export const COMPARISON_REVISION = "meaningful_changes_v2";
export const reportComparisonSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.literal(COMPARISON_REVISION),
  beforeReportId: z.uuid(),
  afterReportId: z.uuid(),
  packageName: z.string().max(214),
  beforeVersion: z.string().max(256),
  afterVersion: z.string().max(256),
  comparable: z.boolean(),
  changed: z.boolean(),
  regression: z.boolean(),
  totalChanges: z.number().int().nonnegative(),
  changesTruncated: z.boolean(),
  changes: z
    .array(
      z.strictObject({
        subject: z.string().max(2500),
        before: z.string().max(2048),
        after: z.string().max(2048),
        regression: z.boolean(),
      }),
    )
    .max(256),
  inputs: z
    .array(
      z.strictObject({
        field: z.string().max(64),
        before: z.string().max(4096),
        after: z.string().max(4096),
      }),
    )
    .max(20),
  limitations: z.array(z.string().max(512)).max(8),
});
export type ReportComparison = z.infer<typeof reportComparisonSchema>;
export const reportHistorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().max(214),
  reports: z
    .array(
      z.strictObject({
        id: z.uuid(),
        scanId: z.uuid(),
        version: z.string().max(256),
        matrixRevision: z.string().max(128),
        observationRevision: z.number().int().nonnegative(),
        previousScanId: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
        current: z.boolean(),
      }),
    )
    .max(50),
  next: z.string().max(512).nullable(),
});
