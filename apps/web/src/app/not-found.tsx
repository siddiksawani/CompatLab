export default function NotFound() {
  return (
    <section className="page narrow">
      <p className="eyebrow">404</p>
      <h1>This page isn’t available.</h1>
      <p>Check the URL or search for a package.</p>
      <a className="button" href="/">
        Explore packages
      </a>
    </section>
  );
}
