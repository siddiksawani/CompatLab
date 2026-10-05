export const contentSignal = "search=yes, ai-input=yes, ai-train=no";

export function discoveryLinks(origin: string) {
  return [
    `<${origin}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
    `<${origin}/openapi.json>; rel="service-desc"; type="application/json"`,
    `<${origin}/api>; rel="service-doc"; type="text/html"`,
  ].join(", ");
}

export function prefersMarkdown(accept: string | null) {
  const ranges = (accept ?? "")
    .toLowerCase()
    .split(",")
    .map((range) => {
      const [type, ...parameters] = range.trim().split(";");
      const quality = parameters
        .map((value) => value.trim())
        .find((value) => value.startsWith("q="))
        ?.slice(2);
      const q =
        quality === undefined
          ? 1
          : /^(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality)
            ? Number(quality)
            : 0;
      return { type: type?.trim(), q };
    });
  const markdown = ranges.find((range) => range.type === "text/markdown")?.q ?? 0;
  const html = ranges.find((range) => range.type === "text/html");
  const fallback =
    ranges.find((range) => range.type === "text/*") ?? ranges.find((range) => range.type === "*/*");
  return markdown > 0 && (html ? markdown > html.q : markdown >= (fallback?.q ?? 0));
}

export function markdownPath(path: string) {
  if (path === "/") return "/index.md";
  return /^\/reports\/[^/]+$/.test(path) ? `${path}/markdown` : null;
}

export function markdownResponse(body: string, canonical: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "content-signal": contentSignal,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, follow",
      vary: "Accept",
      link: `${discoveryLinks(new URL(canonical).origin)}, <${canonical}>; rel="canonical"`,
    },
  });
}
