import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Maintainers — coming soon",
  description:
    "Planned tools for npm package authors to follow releases and investigate runtime changes.",
};
export default function AccountPage() {
  return (
    <section className="page maintainer-page">
      <div className="maintainer-intro">
        <p className="eyebrow">For package authors</p>
        <p className="availability">Coming soon</p>
        <h1>Maintainers</h1>
        <p className="lede">
          Maintainers are the people who develop and release npm packages. We’re planning tools to
          help them follow their releases and understand how runtime behavior changes over time.
        </p>
        <p>
          Maintainer accounts and tools aren’t available yet. Public package scans are ready to use.
        </p>
      </div>
      <section className="feature-grid" aria-labelledby="planned-tools">
        <h2 id="planned-tools">What we’re planning</h2>
        <article>
          <h3>Follow new releases</h3>
          <p>
            Automatically check published versions and receive alerts when loading results change.
          </p>
        </article>
        <article>
          <h3>Investigate changes</h3>
          <p>
            Compare releases, inspect the evidence, and request fresh observations without losing
            history.
          </p>
        </article>
        <article>
          <h3>Check specific behavior</h3>
          <p>
            Add focused, offline tests for documented package behavior alongside the loading checks.
          </p>
        </article>
      </section>
      <div className="notice">
        <h2>Try a public package now</h2>
        <p>Search for any public npm package and inspect an exact version. No account required.</p>
        <div className="actions">
          <a className="button" href="/">
            Explore packages
          </a>
          <a href="/methodology">How scanning works</a>
        </div>
      </div>
    </section>
  );
}
