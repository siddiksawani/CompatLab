import { DocumentLayout } from "../../components/section-navigation";
import { pageMetadata } from "../../server/metadata";

export const metadata = pageMetadata(
  "Methodology and local CLI",
  "How CompatLab tests exact npm artifacts across pinned runtimes, what loading evidence means, and how to reproduce results on a qualified Linux host.",
  "/methodology",
);
export default function Methodology() {
  const commands = [
    "git clone https://github.com/siddiksawani/CompatLab.git",
    "cd CompatLab",
    "pnpm install --frozen-lockfile",
    "pnpm build",
    "pnpm cli doctor --json",
    'sudo "$(command -v node)" apps/cli/dist/bin.js check is-number@7.0.0 --json',
  ].join("\n");
  return (
    <DocumentLayout
      sections={[
        { id: "preparation", label: "Preparation" },
        { id: "loading", label: "Loading checks" },
        { id: "outcomes", label: "Outcomes" },
        { id: "limits", label: "Limits" },
        { id: "local-cli", label: "Local CLI" },
        { id: "retention", label: "Retention" },
        { id: "maintainers", label: "Maintainer tools" },
        { id: "assertions", label: "Assertions and CI" },
      ]}
    >
      <h1>Methodology</h1>
      <p className="lede">
        CompatLab observes exact published packages in a controlled consumer workspace. Each report
        names its inputs, coverage and limits.
      </p>
      <h2 id="preparation">One artifact, one shared snapshot</h2>
      <p>
        The service resolves an exact npm version, verifies supplied integrity, and uses a pinned
        npm installer with lifecycle scripts disabled. Every runtime in a comparison reads the same
        sealed dependency snapshot. Preparation and package code execute on a dedicated Linux amd64
        host behind gVisor, outside the web and database services.
      </p>
      <h2 id="loading">Independent roots, ordered subpaths</h2>
      <p>
        ESM import and CommonJS require each start in a fresh sandbox. Explicit executable subpaths
        are observed in ordered batches; those entries share a module cache and globals. Root
        success does not imply complete subpath coverage. Wildcard patterns, assets, work limits and
        interruptions stay visible.
      </p>
      <h2 id="outcomes">Reading outcomes</h2>
      <dl className="definitions">
        <dt>Passed</dt>
        <dd>Every applicable planned observation in this group succeeded.</dd>
        <dt>Mixed results</dt>
        <dd>Valid successes and failures coexist.</dd>
        <dt>Failed</dt>
        <dd>An applicable loading operation failed with retained evidence.</dd>
        <dt>Inconclusive</dt>
        <dd>
          Coverage, resource limits, policy or prerequisites prevented a complete observation.
        </dd>
        <dt>Unsupported workflow</dt>
        <dd>
          The requested workflow needs something excluded by this profile, such as native
          compilation.
        </dd>
        <dt>Not applicable</dt>
        <dd>No executable public path applies to that group.</dd>
        <dt>Service error</dt>
        <dd>
          The service could not produce a valid observation. This is separate from a package loading
          failure.
        </dd>
      </dl>
      <h2 id="limits">What success does not establish</h2>
      <p>
        Loading does not exercise arbitrary functions, test an application, or establish safety.
        Package-visible harness observations can be tampered with by malicious code in the same
        process. Stdout and stderr are logs, never verdicts. Only a named behavioral assertion can
        earn a separate probe-verified evidence label.
      </p>
      <h2 id="local-cli">Run the local CLI</h2>
      <p>
        The CLI is included in the source repository. It is not currently published as an npm
        package, and downloading a report does not install a <code>compatlab</code> command. Use
        Node.js 24.21.0 and pnpm 12.8.1 to build it, then run <code>pnpm cli</code> or the compiled
        entry point below from the repository directory.
      </p>
      <p>
        Use a dedicated Linux amd64 host with the qualified Docker/runsc, mount and firewall
        prerequisites. Ordinary Docker alone does not reproduce this execution profile. The CLI
        refuses to fall back to host execution. On macOS or Windows, use a separate qualified Linux
        machine or VM. Do not run another CLI supervisor on the active production worker.
      </p>
      <pre>
        <code>{commands}</code>
      </pre>
      <p>
        The example above makes a new check and builds its runtime images locally. Replaying a
        hosted report additionally requires its exact runtime images. Those images are not yet
        distributed for public download; an operator must export them from the originating worker
        and load them on the replay host. Building the same recipe again can produce different image
        IDs and is not exact replay.
      </p>
      <p>
        Reproduction can reuse the actual retained snapshot or explicitly rebuild from downloaded
        inputs and their exact lock. Rebuilding records a new generation and may produce different
        installed bytes. Missing images, unavailable artifacts or required prerequisites can prevent
        replay.
      </p>
      <a
        href="https://github.com/siddiksawani/CompatLab/blob/main/docs/probe-execution.md"
        rel="noreferrer"
      >
        Read the complete execution setup and limits →
      </a>
      <h2 id="retention">Public evidence and retention</h2>
      <p>
        Reports, locks and provenance are public and retained as history. Raw package logs expire
        after 30 days. Sealed worker snapshots have a bounded cache and can become unavailable
        before report metadata expires. Quarantine and invalidation appear on historical reports.
      </p>
      <h2 id="maintainers">Maintainer tools: coming soon</h2>
      <p>
        We’re planning tools for package authors to monitor releases and add focused, offline
        behavioral checks. Maintainer accounts and assertion registration are not available through
        the website yet. <a href="/account">See what’s planned for maintainers.</a>
      </p>
      <h2 id="assertions">Historical assertions and local CI archives</h2>
      <p>
        Existing reports can include a named assertion with its own outcome and immutable source.
        Successful loading never becomes behavioral verification. Reproduction inputs include the
        retained assertion bundle when one was selected. The CLI also supports pre-publication
        archives on a qualified Linux/runsc host. Those reports use a distinct CI artifact identity
        with caller-supplied workflow provenance. There is no public archive upload endpoint.
      </p>
      <p>
        <a href="https://github.com/siddiksawani/CompatLab/blob/main/docs/assertions-and-ci.md">
          Manifest format, examples and CI setup
        </a>
      </p>
    </DocumentLayout>
  );
}
