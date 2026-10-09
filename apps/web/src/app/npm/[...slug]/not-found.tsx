export default function MissingPackageEvidence() {
  return (
    <section className="page narrow">
      <h1>No published evidence at this address</h1>
      <p>
        Use an exact package version. No eligible report is available here; this is not a
        compatibility failure.
      </p>
      <a className="button" href="/">
        Find a package
      </a>
    </section>
  );
}
