import { z } from "zod";

export const HARNESS_SCHEMA_VERSION = 1;
export const MAX_COMPLETION_BYTES = 64 * 1024;
export const probeModeSchema = z.enum(["esm", "commonjs"]);

const completionFields = {
  schemaVersion: z.literal(HARNESS_SCHEMA_VERSION),
  probeId: z.uuid(),
  mode: probeModeSchema,
  completed: z.literal(true),
  durationMs: z.number().finite().min(0).max(900_000),
};

export const harnessCompletionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ ...completionFields, outcome: z.literal("pass") }),
  z.strictObject({
    ...completionFields,
    outcome: z.literal("fail"),
    error: z.strictObject({ name: z.string().max(128), message: z.string().max(4096) }),
  }),
]);

export type ProbeMode = z.infer<typeof probeModeSchema>;
export type HarnessCompletion = z.infer<typeof harnessCompletionSchema>;

export type CompletionDecision =
  | { accepted: true; observation: HarnessCompletion }
  | {
      accepted: false;
      classification: "unexpected_process_exit" | "harness_protocol_error";
      reason: string;
    };

export function evaluateCompletion(input: {
  exitCode: number | null;
  fileContents: Uint8Array | null;
  expectedProbeId: string;
  expectedMode: ProbeMode;
}): CompletionDecision {
  if (input.exitCode !== 0) {
    return {
      accepted: false,
      classification: "unexpected_process_exit",
      reason: "The probe process did not exit successfully.",
    };
  }

  const reject = (reason: string): CompletionDecision => ({
    accepted: false,
    classification: "harness_protocol_error",
    reason,
  });

  if (!input.fileContents?.byteLength) return reject("The completion file is missing or empty.");
  if (input.fileContents.byteLength > MAX_COMPLETION_BYTES) {
    return reject("The completion file exceeds the byte limit.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.fileContents));
  } catch {
    return reject("The completion file is not valid UTF-8 JSON.");
  }

  const result = harnessCompletionSchema.safeParse(raw);
  if (!result.success) return reject("The completion file does not match the supported schema.");
  if (result.data.probeId !== input.expectedProbeId || result.data.mode !== input.expectedMode) {
    return reject("The completion file belongs to a different probe.");
  }

  return { accepted: true, observation: result.data };
}
