import "server-only";
import { discoverReports, reportControlError } from "@compatlab/catalog/web";
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
