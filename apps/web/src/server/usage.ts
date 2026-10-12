import "server-only";
import { type EvidenceUsage, usageContext } from "@compatlab/catalog/web";
import { headers } from "next/headers";
import { webRuntime } from "./runtime";

export async function recordPageUsage(
  surface: "report_page" | "package_page",
  availability: EvidenceUsage["availability"],
) {
  const request = await headers();
  if (
    request.get("x-compatlab-method") !== "GET" ||
    request.has("next-router-prefetch") ||
    request.get("purpose") === "prefetch"
  )
    return;
  const { config, recordUsage } = webRuntime();
  await recordUsage({
    surface,
    availability,
    ...usageContext(new Headers(request), config.origin),
  });
}
