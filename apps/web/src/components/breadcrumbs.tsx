import { headers } from "next/headers";
import { publicOrigin } from "../server/metadata";

export async function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: publicOrigin() + item.path,
    })),
  };
  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          {items.map((item, index) => (
            <li key={item.path}>
              <a href={item.path} aria-current={index === items.length - 1 ? "page" : undefined}>
                {item.name}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(data).replaceAll("<", "\\u003c")}
      </script>
    </>
  );
}
