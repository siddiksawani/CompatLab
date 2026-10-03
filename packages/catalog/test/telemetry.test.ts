import { expect, it } from "vitest";
import { safeErrorEvent } from "../src/telemetry.js";

it("sends only allowlisted error identifiers without package, host, request or user data", () => {
  const result = safeErrorEvent({
    type: undefined,
    event_id: "a".repeat(32),
    timestamp: 123,
    message: "public_request_failed",
    user: { email: "private@example.com" },
    request: { url: "https://example.com?token=secret", data: "package contents" },
    server_name: "host-secret",
    breadcrumbs: [{ message: "password" }],
    extra: { token: "secret" },
    exception: { values: [{ value: "sensitive error" }] },
  });
  expect(result).toEqual({
    type: undefined,
    event_id: "a".repeat(32),
    timestamp: 123,
    message: "public_request_failed",
    level: "error",
    fingerprint: ["public_request_failed"],
    platform: "node",
  });
  expect(safeErrorEvent({ type: undefined, message: "arbitrary package error" })).toBeNull();
});
