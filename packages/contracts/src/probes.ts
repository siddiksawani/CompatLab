import { z } from "zod";
import { probeModeSchema } from "./harness.js";

export const PROBE_HARNESS_REVISION = "load_v2";
export const PROBE_POLICY_REVISION = "runtime_limits_v1";
export const MAX_BATCH_BYTES = 2 * 1024 ** 2;
export const MAX_REPORT_BYTES = 20 * 1024 ** 2;
export const MAX_SCAN_LOG_BYTES = 4 * 1024 ** 2;
export const PROBE_LIMITS = {
  entryMs: 30_000,
  batchMs: 120_000,
  scanMs: 900_000,
  restarts: 3,
} as const;
export const probeGroupSchema = z.enum(["root", "subpaths"]);
const specifierSchema = z
  .string()
  .min(1)
  .max(2304)
  .regex(/^(?:@[a-zA-Z0-9_.~-]+\/)?[a-zA-Z0-9_~-][a-zA-Z0-9_.~-]*(?:\/[^\\\s?#%]+)*$/)
  .refine((value) => !value.split("/").some((part) => part === "." || part === ".."));
export const probeInputSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    probeId: z.uuid(),
    mode: probeModeSchema,
    group: probeGroupSchema,
    entries: z.array(specifierSchema).min(1).max(512),
    startIndex: z.number().int().min(0).max(511),
  })
  .superRefine((input, context) => {
    if (
      input.startIndex >= input.entries.length ||
      (input.group === "root" && (input.entries.length !== 1 || input.startIndex !== 0))
    )
      context.addIssue({ code: "custom", message: "Invalid probe range." });
  });
export const loadObservationSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    index: z.number().int().min(0).max(511),
    outcome: z.literal("pass"),
    resolvedTo: z.string().max(4096).nullable(),
    durationMs: z.number().min(0).max(900_000),
    valueType: z.enum([
      "undefined",
      "object",
      "boolean",
      "number",
      "bigint",
      "string",
      "symbol",
      "function",
    ]),
  }),
  z.strictObject({
    index: z.number().int().min(0).max(511),
    outcome: z.literal("fail"),
    resolvedTo: z.string().max(4096).nullable(),
    durationMs: z.number().min(0).max(900_000),
    error: z.strictObject({
      name: z.string().max(128),
      message: z.string().max(2048),
      code: z.string().max(128).nullable(),
    }),
  }),
]);
export const probeCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(2),
  probeId: z.uuid(),
  mode: probeModeSchema,
  group: probeGroupSchema,
  completed: z.boolean(),
  activeIndex: z.number().int().min(0).max(511).nullable(),
  observations: z.array(loadObservationSchema).max(512),
});
export const stopReasonSchema = z.enum([
  "completed",
  "entry_timeout",
  "batch_timeout",
  "scan_deadline",
  "cancelled",
  "output_limit_exceeded",
  "memory_limit_exceeded",
  "sandbox_start_failed",
  "harness_protocol_error",
  "unexpected_process_exit",
]);
export type ProbeInput = z.infer<typeof probeInputSchema>;
export type LoadObservation = z.infer<typeof loadObservationSchema>;
export type ProbeCheckpoint = z.infer<typeof probeCheckpointSchema>;
export type StopReason = z.infer<typeof stopReasonSchema>;
export const probeSessionSchema = z.strictObject({
  probeId: z.uuid(),
  startIndex: z.number().int().min(0).max(511),
  stopReason: stopReasonSchema,
  exitCode: z.number().int().nullable(),
  oomKilled: z.boolean(),
  durationMs: z.number().min(0),
  checkpoint: probeCheckpointSchema.nullable(),
  logs: z.strictObject({
    stdout: z.string(),
    stderr: z.string(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
    emittedBytes: z.number().int().nonnegative(),
  }),
});
export const probeGroupResultSchema = z.strictObject({
  profileId: z.string().max(64),
  group: probeGroupSchema,
  mode: probeModeSchema,
  method: z.enum(["fresh_root_v2", "sequential_batch_v2"]),
  entries: z.array(specifierSchema).max(512),
  sessions: z.array(probeSessionSchema).max(4),
  observations: z.array(loadObservationSchema).max(512),
  interruptions: z
    .array(
      z.strictObject({
        index: z.number().int().min(0).max(511).nullable(),
        reason: stopReasonSchema,
      }),
    )
    .max(4),
  coverage: z.strictObject({
    planned: z.number().int().min(0).max(512),
    observed: z.number().int().min(0).max(512),
    interrupted: z.number().int().min(0).max(512),
    untested: z.number().int().min(0).max(512),
    complete: z.boolean(),
  }),
});
export type ProbeSession = z.infer<typeof probeSessionSchema>;
export type ProbeGroupResult = z.infer<typeof probeGroupResultSchema>;

export function parseProbeCheckpoint(bytes: Uint8Array, input: ProbeInput): ProbeCheckpoint {
  const limit = input.group === "root" ? 64 * 1024 : MAX_BATCH_BYTES;
  const value = probeCheckpointSchema.parse(parseBoundedJson(bytes, limit, 8));
  if (value.probeId !== input.probeId || value.mode !== input.mode || value.group !== input.group)
    throw new TypeError("Checkpoint belongs to another probe.");
  if (value.observations.some((entry, index) => entry.index !== input.startIndex + index))
    throw new TypeError("Checkpoint observations are out of order.");
  const next = input.startIndex + value.observations.length;
  if (
    next > input.entries.length ||
    (value.activeIndex !== null && (value.activeIndex !== next || next >= input.entries.length)) ||
    (value.completed && (next !== input.entries.length || value.activeIndex !== null))
  )
    throw new TypeError("Checkpoint progress is inconsistent.");
  return value;
}

export function parseBoundedJson(bytes: Uint8Array, limit: number, maximumDepth = 32): unknown {
  if (!bytes.length || bytes.length > limit) throw new TypeError("JSON byte limit exceeded.");
  let depth = 0,
    inString = false,
    escaped = false;
  for (const byte of bytes) {
    if (inString) {
      if (!escaped && byte === 34) inString = false;
      escaped = !escaped && byte === 92;
    } else if (byte === 34) {
      inString = true;
      escaped = false;
    } else if (byte === 123 || byte === 91) {
      if (++depth > maximumDepth) throw new TypeError("JSON depth exceeded.");
    } else if (byte === 125 || byte === 93) depth--;
  }
  return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
}
