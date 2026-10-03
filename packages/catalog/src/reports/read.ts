import { createHash } from "node:crypto";
import {
  hostedReportSchema,
  probeGroupResultSchema,
  probeSessionSchema,
  reproductionInputsSchema,
} from "@compatlab/contracts";
import { boundedText, sanitizeJson, sanitizeText } from "@compatlab/engine";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CatalogDatabase } from "../database.js";
import { selectionAllowed } from "../policy.js";
import { scanProgress } from "../scheduling/reconcile.js";
import { preparations, reports, runs, scans } from "../schema.js";

export async function reportHeader(db: CatalogDatabase, reportId: string) {
  z.uuid().parse(reportId);
  const [row] = (
    await db.execute<{
      id: string;
      scanId: string;
      invalidatedAt: string | null;
      invalidationReason: string | null;
      replacedBy: string | null;
      snapshotAvailable: boolean;
      policyAllowed: boolean;
      createdAt: string;
    }>(sql`SELECT r.id,r.scan_id AS "scanId",r.invalidated_at AS "invalidatedAt",r.invalidation_reason AS "invalidationReason",r.replaced_by AS "replacedBy",
    prep.snapshot_available AS "snapshotAvailable",(${selectionAllowed}) AS "policyAllowed",r.created_at AS "createdAt"
    FROM reports r JOIN scans s ON s.id=r.scan_id JOIN preparations prep ON prep.id=s.preparation_id
    JOIN package_versions v ON v.id=prep.artifact_id JOIN packages p ON p.id=v.package_id JOIN matrices m ON m.id=s.matrix_id
    WHERE r.id=${reportId}`)
  ).rows;
  if (!row) return null;
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    invalidatedAt: row.invalidatedAt ? new Date(row.invalidatedAt).toISOString() : null,
    invalidationReason: row.invalidationReason ? sanitizeText(row.invalidationReason) : null,
    current: row.policyAllowed && !row.invalidatedAt && !row.replacedBy,
  };
}

async function reportPayload(db: CatalogDatabase, reportId: string) {
  const [row] = await db
    .select({ payload: reports.payload })
    .from(reports)
    .where(eq(reports.id, reportId));
  return row ? hostedReportSchema.parse(row.payload) : null;
}
export async function readReport(db: CatalogDatabase, reportId: string) {
  const status = await reportHeader(db, reportId);
  if (!status) return null;
  const report = await reportPayload(db, reportId);
  if (!report) return null;
  return { schemaVersion: 1 as const, status, report };
}

const storedLogsSchema = z.object({
  sessions: z.array(z.object({ probeId: z.uuid(), ...probeSessionSchema.shape.logs.shape })).max(4),
});
export async function readReportLogs(db: CatalogDatabase, reportId: string, runId: string) {
  z.uuid().parse(reportId);
  z.uuid().parse(runId);
  const [row] = await db
    .select({ logs: runs.logs, expiresAt: runs.logsExpireAt })
    .from(runs)
    .innerJoin(reports, eq(reports.scanId, runs.scanId))
    .where(and(eq(reports.id, reportId), eq(runs.id, runId)));
  if (!row) return null;
  const expiresAt = row.expiresAt?.toISOString() ?? null;
  if (row.expiresAt && row.expiresAt <= new Date())
    return {
      schemaVersion: 1,
      runId,
      availability: "expired",
      expiresAt,
      sanitization: "display_v1",
      sessions: [],
    };
  if (!row.logs)
    return {
      schemaVersion: 1,
      runId,
      availability: "not_recorded",
      expiresAt,
      sanitization: "display_v1",
      sessions: [],
    };
  let budget = 256 * 1024;
  const sessions = storedLogsSchema.parse(row.logs).sessions.map((session) => {
    const stdout = boundedText(session.stdout, budget);
    budget -= Buffer.byteLength(stdout.text);
    const stderr = boundedText(session.stderr, budget);
    budget -= Buffer.byteLength(stderr.text);
    return {
      ...session,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: session.stdoutTruncated || stdout.truncated,
      stderrTruncated: session.stderrTruncated || stderr.truncated,
    };
  });
  return {
    schemaVersion: 1,
    runId,
    availability: "available",
    expiresAt,
    sanitization: "display_v1",
    sessions,
  };
}

export async function reproductionReport(db: CatalogDatabase, reportId: string) {
  const report = await reportPayload(db, reportId);
  if (!report?.preparation.snapshot) return null;
  return reproductionInputsSchema.parse({
    schemaVersion: 1,
    kind: "reproduction_inputs",
    reportId: report.id,
    artifact: report.artifact,
    snapshot: report.preparation.snapshot,
    images: report.matrix.images,
    harnessRevision: report.matrix.harnessRevision,
    policyRevision: report.matrix.policyRevision,
  });
}

export function createReportApi(db: CatalogDatabase) {
  let inFlight = 0;
  return async (request: Request): Promise<Response> => {
    if (inFlight >= 4) return json({ error: "busy" }, 503, { "retry-after": "2" });
    inFlight++;
    try {
      if (request.method !== "GET" && request.method !== "HEAD")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
      const response = await handleRead(request);
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    } catch (error) {
      if (error instanceof InvalidIdentifier || error instanceof URIError)
        return json({ error: "invalid_identifier" }, 400);
      process.stderr.write('{"level":"error","event":"report_read_failed"}\n');
      return json({ error: "temporarily_unavailable" }, 503, { "retry-after": "5" });
    } finally {
      inFlight--;
    }
  };

  async function handleRead(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const progress = /^\/api\/v1\/scans\/([^/]+)$/.exec(url.pathname);
    if (progress) {
      const id = identifier(progress[1]);
      const result = await scanProgress(db, id);
      if (!result) return json({ error: "not_found" }, 404);
      const etag = `"scan-${id}-${result.revision}"`;
      return conditional(request, etag) ?? json(result, 200, { etag });
    }
    const match = /^\/api\/v1\/reports\/([^/]+)(?:\/(json|logs|evidence|reproduction|lock))?$/.exec(
      url.pathname,
    );
    if (!match) return json({ error: "not_found" }, 404);
    const id = identifier(match[1]);
    const part = match[2];
    const status = await reportHeader(db, id);
    if (!status) return json({ error: "not_found" }, 404);
    if (part === "logs") {
      const logs = await readReportLogs(db, id, identifier(url.searchParams.get("runId")));
      return logs ? json(logs) : json({ error: "not_found" }, 404);
    }
    if (part === "evidence") {
      const runId = identifier(url.searchParams.get("runId"));
      const [row] = await db
        .select({ raw: runs.rawEvidence })
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.scanId, status.scanId)));
      return row
        ? json({
            schemaVersion: 1,
            runId,
            sanitization: "display_v1",
            evidence: row.raw ? sanitizeJson(probeGroupResultSchema.parse(row.raw)) : null,
          })
        : json({ error: "not_found" }, 404);
    }
    const etag = `"${createHash("sha256")
      .update(JSON.stringify({ part: part ?? "report", status }))
      .digest("hex")}"`;
    const cached = conditional(request, etag);
    if (cached) return cached;
    if (part === "lock") {
      const [row] = await db
        .select({ bytes: preparations.lockBytes, digest: preparations.lockDigest })
        .from(preparations)
        .innerJoin(scans, eq(scans.preparationId, preparations.id))
        .where(eq(scans.id, status.scanId));
      if (!row?.bytes) return json({ error: "lock_unavailable" }, 404);
      return new Response(new Uint8Array(row.bytes), {
        headers: {
          ...headers,
          etag,
          "content-disposition": 'attachment; filename="package-lock.json"',
          "x-content-sha256": row.digest ?? "",
        },
      });
    }
    if (part === "reproduction") {
      const reproduction = await reproductionReport(db, id);
      return reproduction
        ? json(reproduction, 200, {
            etag,
            "content-disposition": `attachment; filename="${id}-reproduction.json"`,
          })
        : json({ error: "reproduction_unavailable" }, 409);
    }
    const report = await reportPayload(db, id);
    if (!report) return json({ error: "not_found" }, 404);
    return json({ schemaVersion: 1, status, report }, 200, {
      etag,
      ...(part === "json" ? { "content-disposition": `attachment; filename="${id}.json"` } : {}),
    });
  }
}
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
}
function conditional(request: Request, etag: string) {
  const values = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((value) => value.trim().replace(/^W\//, ""));
  return values?.includes(etag)
    ? new Response(null, { status: 304, headers: { ...headers, etag } })
    : null;
}

class InvalidIdentifier extends Error {}
function identifier(value: unknown) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new InvalidIdentifier();
  return parsed.data;
}
