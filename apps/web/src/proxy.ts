import { type NextRequest, NextResponse } from "next/server";
import {
  contentSignal,
  discoveryLinks,
  markdownPath,
  prefersMarkdown,
} from "./server/content-discovery";
import { publicOrigin } from "./server/metadata";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}; style-src 'self' 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  headers.set("x-nonce", nonce);
  const alternate = markdownPath(request.nextUrl.pathname);
  const markdown =
    alternate &&
    ["GET", "HEAD"].includes(request.method) &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-router-prefetch") &&
    prefersMarkdown(request.headers.get("accept"));
  const destination = request.nextUrl.clone();
  if (alternate) destination.pathname = alternate;
  const response = markdown
    ? NextResponse.rewrite(destination, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("content-signal", contentSignal);
  if (
    !markdown &&
    request.nextUrl.pathname !== "/index.md" &&
    !/^\/reports\/[^/]+\/markdown$/.test(request.nextUrl.pathname)
  ) {
    response.headers.set(
      "link",
      discoveryLinks(publicOrigin()) +
        (alternate
          ? `, <${publicOrigin()}${alternate}>; rel="alternate"; type="text/markdown"`
          : ""),
    );
  }
  return response;
}
export const config = { matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"] };
