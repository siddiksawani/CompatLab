import { DocumentLayout } from "../../components/section-navigation";
import { pageMetadata } from "../../server/metadata";

export const metadata = pageMetadata(
  "Privacy and retention",
  "What CompatLab retains for anonymous scans, public reports and operational logs, and how to request removal.",
  "/privacy",
);
export default function Privacy() {
  return (
    <DocumentLayout
      sections={[
        { id: "requests", label: "Request handling" },
        { id: "retention", label: "Retention" },
        { id: "accounts", label: "Accounts" },
        { id: "providers", label: "Service providers" },
        { id: "removal", label: "Corrections and removal" },
        { id: "assertions", label: "Behavioral evidence" },
      ]}
    >
      <h1>Privacy and retention</h1>
      <p>
        Anonymous package discovery and report viewing require no email or account. Package reports,
        artifact identities and recorded observations are public. Do not put secrets or personal
        data in public package contents or output.
      </p>
      <h2 id="requests">Request handling</h2>
      <p>
        The ingress uses your network address to limit abuse. Admission stores a keyed identifier
        that rotates daily, groups IPv6 addresses by /64, and is removed after seven days. Raw
        addresses are not stored in the catalog. The default deployment disables access logs and
        filters request details from proxy errors. There is no advertising or browser analytics
        integration.
      </p>
      <p>
        For successful package-version lookups, we retain the public package name, exact version,
        UTC day and whether current, earlier or no eligible evidence was available. Repeated lookups
        of the same package, version and availability count at most once per ten-minute window
        across all visitors. These totals include automated clients and are not visitor or
        unique-user counts. We store no address, cookie, user agent, referrer or search text with
        them. Collection is best effort, capped at 1,000 package/version/availability rows per day,
        and expires after 30 UTC days. Viewing evidence never submits a scan; an operator reviews
        missing evidence before adding packages to the separate coverage queue.
      </p>
      <h2 id="retention">Retention</h2>
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
      <h2 id="accounts">Maintainer accounts</h2>
      <p>
        <a href="/account">Maintainer tools are coming soon.</a> GitHub sign-in, repository linking,
        release monitoring and email alerts are not available on the public website. We will explain
        their data handling and account controls before they become available.
      </p>
      <h2 id="providers">Service providers</h2>
      <p>
        Discovery requests public npm registry metadata. The control service may send fixed
        operational error names to an operator-configured Sentry endpoint. It does not send package
        contents, request bodies, credentials, network addresses or user profiles to error tracking.
      </p>
      <h2 id="removal">Corrections and removal</h2>
      <p>
        For an incorrect report or public content removal request,{" "}
        <a href="https://github.com/siddiksawani/CompatLab/issues">open a repository issue</a> with
        the report URL and reason. Send sensitive security details through the{" "}
        <a href="/security">private disclosure process</a>. Removal does not rewrite the original
        compatibility classification. Log removal retains the report's structured observations and
        provenance; invalidation marks the report as unsuitable for reuse. The operator audits the
        reason. Do not include sensitive content in a public issue.
      </p>
      <h2 id="assertions">Retained behavioral evidence</h2>
      <p>
        A report may include historical named assertions from public GitHub commits. Their source,
        fixture hashes, approved capabilities and results remain part of the public evidence.
        Registering new maintainer assertions through the website is not available yet.
      </p>
    </DocumentLayout>
  );
}
