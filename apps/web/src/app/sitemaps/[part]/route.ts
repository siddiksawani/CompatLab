import { reportControlError } from "@compatlab/catalog/web";
import { packageEvidencePath } from "../../../components/labels";
import {
  discoveryPackages,
  discoveryReports,
  escapeXml,
  xmlResponse,
} from "../../../server/discovery";
import { editorialPages, publicOrigin } from "../../../server/metadata";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ part: string }> }) {
  const { part } = await params;
  if (part !== "pages.xml" && !/^(npm-)?[a-f0-9]\.xml$/.test(part))
    return new Response(null, { status: 404 });
  try {
    const entries =
      part === "pages.xml"
        ? editorialPages.map((path) => ({ url: publicOrigin() + path, updatedAt: null }))
        : part.startsWith("npm-")
          ? (await discoveryPackages(part[4] ?? "")).map((pkg) => ({
              url: publicOrigin() + packageEvidencePath(pkg.name, pkg.version),
              updatedAt: null,
            }))
          : (await discoveryReports(part[0])).map((report) => ({
              url: `${publicOrigin()}/reports/${report.id}`,
              updatedAt: report.updatedAt,
            }));
    return xmlResponse(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(({ url, updatedAt }) => `<url><loc>${escapeXml(url)}</loc>${updatedAt ? `<lastmod>${updatedAt}</lastmod>` : ""}</url>`).join("")}</urlset>`,
    );
  } catch {
    reportControlError("report_read_failed");
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "retry-after": "60", "cache-control": "no-store" },
    });
  }
}
