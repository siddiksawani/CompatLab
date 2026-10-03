export const metadata = { title: "Privacy and retention" };
export default function Privacy() {
  return (
    <article className="prose">
      <p className="eyebrow">Operating policy</p>
      <h1>Privacy and retention</h1>
      <p>
        Anonymous package discovery and report viewing require no email or account. Package reports,
        artifact identities and recorded observations are public. Do not put secrets or personal
        data in public package contents or output.
      </p>
      <h2>Request handling</h2>
      <p>
        The ingress uses your network address to limit abuse. Admission stores a keyed identifier
        that rotates daily, groups IPv6 addresses by /64, and is removed after seven days. Raw
        addresses are not stored in the catalog. The default deployment disables access logs and
        filters request details from proxy errors. There is no advertising or browser analytics
        integration.
      </p>
      <h2>Retention</h2>
      <ul>
        <li>
          Reports, exact locks, identities and provenance remain available indefinitely. Operators
          can invalidate reports and remove retained package logs after reviewing a request.
        </li>
        <li>
          Sanitized package logs expire after 30 days. The report remains available after log
          expiry.
        </li>
        <li>
          Sealed workspaces and installer caches are retained for at most seven days within the
          worker storage cap. Reproduction availability is shown separately.
        </li>
        <li>
          Service logs are retained for 14 days; operator and security audit events for 180 days.
        </li>
        <li>
          Encrypted database backups are retained for seven days. Deleted identifiers or logs can
          remain in those backups until they expire.
        </li>
      </ul>
      <h2>Service providers</h2>
      <p>
        Discovery requests public npm registry metadata. The control service may send fixed
        operational error names to an operator-configured Sentry endpoint. It does not send package
        contents, request bodies, credentials, network addresses or user profiles to error tracking.
      </p>
      <h2>Corrections and removal</h2>
      <p>
        For an incorrect report or public content removal request,{" "}
        <a href="https://github.com/siddiksawani/CompatLab/issues">open a repository issue</a> with
        the report URL and reason. Send sensitive security details through the{" "}
        <a href="/security">private disclosure process</a>. Removal does not rewrite the original
        compatibility classification. Log removal retains the report's structured observations and
        provenance; invalidation marks the report as unsuitable for reuse. The operator audits the
        reason. Do not include sensitive content in a public issue.
      </p>
    </article>
  );
}
