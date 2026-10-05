"use client";
import { usePathname } from "next/navigation";

export function SiteNavigation() {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation">
      <a href="/" aria-current={path === "/" ? "page" : undefined}>
        Search
      </a>
      <a href="/methodology" aria-current={path === "/methodology" ? "page" : undefined}>
        Methodology
      </a>
      <a href="https://github.com/siddiksawani/CompatLab" rel="noreferrer">
        GitHub
      </a>
    </nav>
  );
}
