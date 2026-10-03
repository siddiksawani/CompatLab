import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./style.css";

export const metadata: Metadata = {
  title: { default: "CompatLab — JavaScript runtime evidence", template: "%s | CompatLab" },
  description:
    "Inspect how exact npm packages install and load across pinned Node.js, Bun and Deno runtimes.",
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <a className="brand" href="/" aria-label="CompatLab home">
            <span className="brand-mark" aria-hidden="true">
              CL
            </span>
            CompatLab
          </a>
          <nav aria-label="Main navigation">
            <a href="/">Explore</a>
            <a href="/methodology">Methodology</a>
            <a href="/account">Maintainers</a>
            <a href="https://github.com/siddiksawani/CompatLab" rel="noreferrer">
              Source
            </a>
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div>
            <strong>CompatLab</strong>
            <p>Exact inputs. Observable results.</p>
          </div>
          <nav aria-label="Footer">
            <a href="/privacy">Privacy &amp; retention</a>
            <a href="/terms">Terms</a>
            <a href="/security">Security &amp; disclosure</a>
            <a href="/methodology">Methodology &amp; CLI</a>
            <a
              href="https://github.com/siddiksawani/CompatLab/blob/main/SECURITY.md"
              rel="noreferrer"
            >
              Security
            </a>
            <a href="https://github.com/siddiksawani/CompatLab/issues" rel="noreferrer">
              Report an issue
            </a>
          </nav>
          <p className="fine">
            Loading evidence describes the tested environment. It does not establish package safety
            or functional correctness.
          </p>
        </footer>
      </body>
    </html>
  );
}
