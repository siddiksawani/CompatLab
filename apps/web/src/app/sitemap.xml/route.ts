import { SITEMAP_PREFIXES } from "@compatlab/catalog/web";
import { escapeXml, xmlResponse } from "../../server/discovery";
import { publicOrigin } from "../../server/metadata";

export const dynamic = "force-dynamic";
export function GET() {
  const paths = [
    "/sitemaps/pages.xml",
    ...SITEMAP_PREFIXES.map((prefix) => `/sitemaps/${prefix}.xml`),
  ];
  return xmlResponse(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<sitemap><loc>${escapeXml(publicOrigin() + path)}</loc></sitemap>`).join("")}</sitemapindex>`,
  );
}
