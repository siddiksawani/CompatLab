export const metadata = { title: "Security and disclosure" };
export default function Security() {
  return (
    <article className="prose">
      <p className="eyebrow">Operating policy</p>
      <h1>Security and disclosure</h1>
      <p>
        Package archives, dependencies and output are treated as untrusted. Preparation and
        execution run on a dedicated Linux host under a pinned gVisor policy. Runtime jobs have no
        network, production secrets, host sockets or writable package workspace. Resource limits are
        enforced outside the package process.
      </p>
      <p>
        These controls and the qualification tests describe the tested boundary. They do not prove
        that packages are safe or that in-process observations cannot be forged. Read the{" "}
        <a href="/methodology">methodology</a> before interpreting a result.
      </p>
      <h2>Report a vulnerability</h2>
      <p>
        Use the repository’s{" "}
        <a href="https://github.com/siddiksawani/CompatLab/security/advisories/new">
          private vulnerability reporting form
        </a>
        . Include affected revisions, a minimal reproduction and the expected boundary. Do not
        publish credentials, private data or an active exploit in a public issue. If the form is
        unavailable, contact <a href="https://github.com/siddiksawani">siddiksawani</a> through the
        contact channel on that profile to arrange a private report.
      </p>
      <h2>Service incidents</h2>
      <p>
        The repository maintainer owns incident response. Public operational updates and resolved
        incident summaries are published through{" "}
        <a href="https://github.com/siddiksawani/CompatLab/issues">repository issues</a>.
        Infrastructure failures are kept separate from package compatibility findings. Reports
        affected by a faulty runtime or policy are marked as historical evidence while the operator
        investigates.
      </p>
    </article>
  );
}
