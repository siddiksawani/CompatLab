import { captureMessage, type ErrorEvent, init } from "@sentry/node";

const events = [
  "public_request_failed",
  "lookup_measurement_failed",
  "coverage_failed",
  "maintainer_request_failed",
  "monitoring_failed",
  "report_read_failed",
  "web_configuration_unavailable",
  "reconciliation_failed",
  "aggregation_failed",
  "retention_failed",
  "operator_command_failed",
  "backup_failed",
] as const;
export type ControlError = (typeof events)[number];
let initialized = false;
export function safeErrorEvent(event: ErrorEvent): ErrorEvent | null {
  if (typeof event.message !== "string" || !events.some((name) => name === event.message))
    return null;
  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    message: event.message,
    level: "error",
    fingerprint: [event.message],
    platform: "node",
  };
}
export function initializeTelemetry(dsn = process.env.SENTRY_DSN) {
  if (initialized || !dsn) return;
  const url = new URL(dsn);
  if (url.protocol !== "https:" || !url.username || url.password)
    throw new TypeError("Use an HTTPS Sentry DSN without a secret key.");
  init({
    dsn,
    defaultIntegrations: false,
    enableRuntimeChannelInjection: false,
    enableOpenTelemetrySetup: false,
    tracesSampleRate: 0,
    profileSessionSampleRate: 0,
    beforeSendLog: () => null,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: safeErrorEvent,
  });
  initialized = true;
}
export function reportControlError(event: ControlError) {
  process.stderr.write(`${JSON.stringify({ level: "error", event })}\n`);
  if (initialized) captureMessage(event, "error");
}
