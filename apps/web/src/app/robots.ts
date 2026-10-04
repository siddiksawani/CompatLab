import type { MetadataRoute } from "next";
import { publicOrigin } from "../server/metadata";

export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${publicOrigin()}/sitemap.xml` };
}
