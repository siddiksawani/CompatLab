import { pageMetadata } from "../../server/metadata";

export const metadata = pageMetadata(
  "Use of the service",
  "Conditions for using CompatLab public npm scans and the limitations of runtime loading evidence.",
  "/terms",
);
export default function Terms() {
  return (
    <article className="page prose">
      <p className="eyebrow">Operating policy</p>
      <h1>Use of the service</h1>
      <p>
        CompatLab publishes limited observations about exact public npm artifacts under the
        environment and policy shown in each report. A passed import or require does not establish
        functional correctness, security, suitability for production or compatibility with another
        environment.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Request public packages through the supported version selector. Respect admission limits. Do
        not evade quotas, interfere with other users, submit private credentials, or use the service
        to attack its infrastructure or third parties. Anonymous custom code and private package
        uploads are not supported.
      </p>
      <h2>Availability and evidence</h2>
      <p>
        This service has no availability or completion guarantee. Scans may be queued, limited,
        cancelled or rejected. Policy changes and discovered faults can invalidate a report without
        changing its historical evidence. Check coverage, timestamps, inputs and reproduction limits
        before using a result in a decision.
      </p>
      <h2>Package rights</h2>
      <p>
        Package publishers retain their rights and licenses. A report does not grant rights to
        redistribute or use package code beyond its license. Links to repositories and publisher
        metadata do not imply publisher endorsement of CompatLab.
      </p>
      <h2>Contact</h2>
      <p>
        The repository maintainer is <a href="https://github.com/siddiksawani">siddiksawani</a>. Use{" "}
        <a href="https://github.com/siddiksawani/CompatLab/issues">repository issues</a> for service
        problems, abuse reports and removal requests. Follow the{" "}
        <a href="/security">security policy</a> for sensitive disclosures and the{" "}
        <a href="/privacy">privacy policy</a> for retention details.
      </p>
    </article>
  );
}
