import type { Metadata } from "next";

export function publicOrigin() {
  return new URL(process.env.PUBLIC_ORIGIN ?? "https://compatlab.me").origin;
}

export function pageMetadata(
  title: string,
  description: string,
  path: string,
  index = true,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index, follow: true },
    openGraph: {
      title: `${title} | CompatLab`,
      description,
      url: path,
      siteName: "CompatLab",
      type: "website",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
  };
}

export const editorialPages = ["/", "/methodology", "/privacy", "/terms", "/security"];
