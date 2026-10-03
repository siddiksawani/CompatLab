"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="page narrow">
      <p className="eyebrow">Service unavailable</p>
      <h1>We couldn’t load this page.</h1>
      <p>Please retry shortly. No package work starts from viewing a page.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
