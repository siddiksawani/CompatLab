import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNavigation } from "../components/site-navigation";
import { publicOrigin } from "../server/metadata";
import "./style.css";

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin()),
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
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            CompatLab
          </a>
          <SiteNavigation />
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <p>Passing a load check does not prove that your app works or that a package is safe.</p>
          <nav aria-label="Footer">
            <a href="https://github.com/siddiksawani/CompatLab" rel="noreferrer">
              GitHub
            </a>
            <a href="/methodology">Methodology &amp; CLI</a>
            <a href="/api">Public API</a>
            <a href="/articles">Articles</a>
            <a href="/privacy">Privacy &amp; retention</a>
            <a href="/terms">Terms</a>
            <a href="/security">Security</a>
            <a href="/privacy#removal">Request removal</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
