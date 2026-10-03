import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  abandonAttempt,
  authenticatedWorker,
  type CatalogDatabase,
  claimJob,
  readyWorker,
  renewJob,
  SchedulingError,
  submitJobResult,
  workerSnapshotPins,
} from "@compatlab/catalog";
import { parseBoundedJson } from "@compatlab/contracts";

const bodyLimit = 32 * 1024 ** 2;
export function createControlServer(db: CatalogDatabase) {
  let inFlight = 0;
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 5000, keepAliveTimeout: 5000 },
    (request, response) => {
      if (inFlight >= 8) {
        reply(response, 503, { error: "busy" });
        request.resume();
        return;
      }
      inFlight++;
      handle(request, response)
        .finally(() => {
          inFlight--;
        })
        .catch(() => response.destroy());
    },
  );
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 64;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const requestId = randomUUID();
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-request-id", requestId);
    try {
      if (
        request.method !== "POST" ||
        ![
          "/v1/workers/ready",
          "/v1/jobs/claim",
          "/v1/jobs/renew",
          "/v1/jobs/results",
          "/v1/jobs/abandon",
        ].includes(request.url ?? "")
      ) {
        reply(response, 404, { error: "not_found" });
        request.resume();
        return;
      }
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer "))
        throw new SchedulingError("unauthorized", "Worker authentication required.");
      const token = authorization.slice(7);
      await authenticatedWorker(db, token);
      if (
        request.headers.origin ||
        request.headers["content-type"]?.split(";", 1)[0] !== "application/json" ||
        request.headers["content-encoding"]
      )
        throw new TypeError("Expected an uncompressed private JSON request.");
      const length = request.headers["content-length"];
      if (length && (!/^\d+$/.test(length) || Number(length) > bodyLimit)) {
        reply(response, 413, { error: "body_limit" });
        request.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        total += bytes.length;
        if (total > bodyLimit) {
          reply(response, 413, { error: "body_limit" });
          request.destroy();
          return;
        }
        chunks.push(bytes);
      }
      const body = parseBoundedJson(Buffer.concat(chunks, total), bodyLimit);
      let result: unknown;
      switch (request.url) {
        case "/v1/workers/ready":
          result = await readyWorker(db, token, body);
          break;
        case "/v1/jobs/claim":
          result = {
            job: await claimJob(db, token, body),
            snapshotIds: await workerSnapshotPins(db, token, body),
          };
          break;
        case "/v1/jobs/renew":
          result = await renewJob(db, token, body);
          break;
        case "/v1/jobs/results":
          result = await submitJobResult(db, token, body);
          break;
        case "/v1/jobs/abandon":
          result = await abandonAttempt(db, token, body);
          break;
      }
      reply(response, 200, result);
    } catch (error) {
      request.resume();
      if (error instanceof SchedulingError)
        reply(
          response,
          error.code === "unauthorized" ? 401 : error.code === "worker_unavailable" ? 503 : 409,
          { error: error.code },
        );
      else if (
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        (error instanceof Error &&
          ["ZodError", "PreparationError", "RegistryError"].includes(error.name))
      )
        reply(response, 400, { error: "invalid_request" });
      else {
        process.stderr.write(
          `${JSON.stringify({ level: "error", event: "private_request_failed", requestId })}\n`,
        );
        reply(response, 500, { error: "control_plane_error" });
      }
    }
  }
  return server;
}
function reply(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
