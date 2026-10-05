import "server-only";
import {
  discoverReportPreviews,
  discoverReports,
  reportControlError,
} from "@compatlab/catalog/web";
import { webRuntime } from "./runtime";

let pending = 0;
export async function discoveryReports(prefix?: string) {
  if (pending >= 2) throw new Error("Discovery is busy.");
  pending++;
  try {
    return await discoverReports(webRuntime().catalog.db, prefix);
  } finally {
    pending--;
  }
}

export async function recentReports() {
  try {
    return await discoveryReports();
  } catch {
    reportControlError("report_read_failed");
    return [];
  }
}

export async function exampleReports(recent: Awaited<ReturnType<typeof recentReports>>) {
  if (pending >= 2) return [];
  pending++;
  try {
    const db = webRuntime().catalog.db;
    const examples = await discoverReportPreviews(db, ["preact", "express", "zod"]);
    if (examples.length || !recent.length) return examples;
    return await discoverReportPreviews(
      db,
      [...new Set(recent.map((report) => report.name))].slice(0, 3),
    );
  } catch {
    reportControlError("report_read_failed");
    return [];
  } finally {
    pending--;
  }
}

export function xmlResponse(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
