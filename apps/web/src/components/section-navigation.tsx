import type { ReactNode } from "react";

type Section = { id: string; label: string };

export function SectionNavigation({ sections }: { sections: Section[] }) {
  return (
    <nav className="section-navigation" aria-label="On this page">
      <span>On this page</span>
      {sections.map(({ id, label }) => (
        <a href={`#${id}`} key={id}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function DocumentLayout({
  sections,
  children,
}: {
  sections: Section[];
  children: ReactNode;
}) {
  return (
    <div className="page docs-layout">
      <SectionNavigation sections={sections} />
      <article className="prose">{children}</article>
    </div>
  );
}
