import { z } from "zod";

export const activitySourceSchema = z.enum([
  "direct",
  "internal",
  "search",
  "github",
  "medium",
  "dev",
  "reddit",
  "peerlist",
  "other",
]);
export const browserActionSchema = z.enum([
  "page_view",
  "search",
  "version_selected",
  "evidence_opened",
  "share_copied",
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export function activityPage(path: string) {
  if (path === "/") return "home" as const;
  if (path === "/packages" || (path.startsWith("/npm/") && !path.startsWith("/npm/compatibility")))
    return "package" as const;
  if (/^\/reports\/[0-9a-f-]{36}$/i.test(path)) return "report" as const;
  return "other" as const;
}
export function activitySource(
  referrer: string,
  origin: string,
): z.infer<typeof activitySourceSchema> {
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (!["http:", "https:"].includes(url.protocol)) return "other";
    if (url.origin === new URL(origin).origin) return "internal";
    const host = url.hostname.toLowerCase();
    if (/^(www\.)?(google\.(com|co\.in|co\.uk)|bing\.com|duckduckgo\.com)$/.test(host))
      return "search";
    const sites = {
      "github.com": "github",
      "medium.com": "medium",
      "dev.to": "dev",
      "reddit.com": "reddit",
      "peerlist.io": "peerlist",
    } as const;
    for (const [domain, source] of Object.entries(sites))
      if (host === domain || host.endsWith(`.${domain}`)) return source;
  } catch {}
  return "other";
}
export const browserActivitySchema = z
  .strictObject({
    actions: z.array(browserActionSchema).min(1).max(5),
    page: z.enum(["home", "package", "report", "other"]),
    source: activitySourceSchema,
    research: z.boolean(),
    automated: z.boolean(),
  })
  .refine(
    ({ actions, page }) =>
      new Set(actions).size === actions.length &&
      actions.every(
        (action) =>
          action === "page_view" ||
          (action === "search" && page === "home") ||
          (action === "version_selected" && page === "package") ||
          (["evidence_opened", "share_copied"].includes(action) && page === "report"),
      ),
    "Use distinct actions on their matching page category.",
  );
export type BrowserActivity = z.infer<typeof browserActivitySchema>;
