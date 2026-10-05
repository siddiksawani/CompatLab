import { contentSignal } from "../../server/content-discovery";
import { publicOrigin } from "../../server/metadata";

export const dynamic = "force-dynamic";
export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nContent-Signal: ${contentSignal}\n\nSitemap: ${publicOrigin()}/sitemap.xml\n`,
    {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
