import { admissionRequestSchema, CLASSIFIER_REVISION } from "@compatlab/contracts";
import {
  assertPackageName,
  isExactVersion,
  RegistryClient,
  RegistryError,
} from "@compatlab/engine";
import { z } from "zod";
import { admitScan } from "../admission.js";
import type { CatalogDatabase } from "../database.js";
import { createReportApi } from "../reports/read.js";
import { reportControlError } from "../telemetry.js";
import { MetadataBusy } from "./cache.js";
import { publicDiscovery } from "./discovery.js";
import { lookupRecorder } from "./measurement.js";
import {
  type PublicConfig,
  PublicRequestError,
  publicConfigSchema,
  readAdmissionBody,
  requesterIdentity,
} from "./security.js";

export function createPublicApi(
  db: CatalogDatabase,
  rawConfig: PublicConfig,
  registry = new RegistryClient(),
  accountQuota?: (request: Request) => Promise<string | undefined>,
) {
  const config = publicConfigSchema.parse(rawConfig);
  const discovery = publicDiscovery(db, config.matrixId, config.scansEnabled, registry);
  const reports = createReportApi(db);
  const recordLookup = lookupRecorder(db);
  let inFlight = 0;
  return async (request: Request): Promise<Response> => {
    const response = await handle(request);
    return request.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  };
  async function handle(request: Request): Promise<Response> {
    if (inFlight >= 8) return json({ error: "busy" }, 503, { "retry-after": "2" });
    inFlight++;
    try {
      const url = new URL(request.url);
      if (
        /^\/api\/v1\/(?:reports\/|scans\/|comparisons(?:\/|$)|history(?:\/|$)|badges\/)/.test(
          url.pathname,
        )
      )
        return await reports(request);
      if (url.pathname === "/api/v1/scans" && request.method === "POST") {
        const identity = requesterIdentity(request, config);
        const accountKey = await accountQuota?.(request);
        const body = admissionRequestSchema.parse(await readAdmissionBody(request, config.origin));
        assertPackageName(body.name);
        if (!isExactVersion(body.version))
          throw new PublicRequestError(400, "exact_version_required");
        if (!config.scansEnabled)
          return json({ error: "scans_paused" }, 503, { "retry-after": "60" });
        const result = await admitScan(db, await discovery.resolve(body.name, body.version), {
          matrixId: config.matrixId,
          ...identity,
          ...(accountKey ? { accountKey } : {}),
          classifierRevision: CLASSIFIER_REVISION,
        });
        return json(
          result,
          result.kind === "blocked"
            ? 403
            : result.kind === "throttled"
              ? ["worker_unavailable", "admission_paused"].includes(result.reason)
                ? 503
                : 429
              : result.kind === "admitted"
                ? 202
                : 200,
          result.kind === "throttled" ? { "retry-after": String(result.retryAfterSeconds) } : {},
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
      let response: Response;
      if (url.pathname === "/api/v1/search")
        response = json(await discovery.search(url.searchParams.get("q") ?? ""));
      else if (url.pathname === "/api/v1/packages") {
        const pkg = await discovery.package(
          url.searchParams.get("name") ?? "",
          url.searchParams.get("version") ?? undefined,
        );
        if (request.method === "GET") await recordLookup(pkg);
        response = json(pkg);
      } else response = json({ error: "not_found" }, 404);
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    } catch (error) {
      if (error instanceof PublicRequestError) return json({ error: error.code }, error.status);
      if (error instanceof z.ZodError || error instanceof TypeError)
        return json({ error: "invalid_request" }, 400);
      if (error instanceof MetadataBusy)
        return json({ error: "busy" }, 503, { "retry-after": "2" });
      if (error instanceof RegistryError)
        return json(
          { error: error.classification },
          ["package_not_found", "package_version_not_found"].includes(error.classification)
            ? 404
            : 503,
          { "retry-after": "5" },
        );
      reportControlError("public_request_failed");
      return json({ error: "temporarily_unavailable" }, 503, { "retry-after": "5" });
    } finally {
      inFlight--;
    }
  }
}
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}
