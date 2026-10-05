import { packageResponseSchema } from "@compatlab/contracts";
import { readError } from "../../components/labels";
import { RequestScan } from "../../components/request-scan";
import { VersionPicker } from "../../components/version-picker";
import { publicRead } from "../../server/runtime";

export const metadata = {
  title: "Select an exact npm package version",
  robots: { index: false, follow: true },
};
export default async function PackagePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[]; version?: string | string[] }>;
}) {
  const query = await searchParams;
  const name = typeof query.name === "string" ? query.name : "";
  const version = typeof query.version === "string" ? query.version : undefined;
  const response = await publicRead(
    `/api/v1/packages?${new URLSearchParams({ name, ...(version ? { version } : {}) })}`,
  );
  if (!response.ok)
    return (
      <section className="page narrow">
        <a href="/" className="back">
          ← Package search
        </a>
        <h1>Package unavailable</h1>
        <p role="status">{readError(response.status)}</p>
      </section>
    );
  const pkg = packageResponseSchema.parse(await response.json());
  return (
    <section className="page">
      <a href="/" className="back">
        ← Package search
      </a>
      <p className="eyebrow">Published npm artifact</p>
      <h1 className="package-title">{pkg.name}</h1>
      <p className="lede">{pkg.description}</p>
      <div className="metadata-row">
        <span className="mono">Version {pkg.version}</span>
        {pkg.repositoryUrl && (
          <a href={pkg.repositoryUrl} rel="noreferrer">
            Source repository ↗
          </a>
        )}
        <span>Linux amd64 / glibc</span>
      </div>
      {pkg.deprecated !== null && (
        <aside className="notice warning">
          <strong>Deprecated by the publisher</strong>
          <p>{pkg.deprecated || "The publisher marked this version as deprecated."}</p>
          <p>Available artifacts can still be inspected.</p>
        </aside>
      )}
      <div className="package-actions">
        <VersionPicker pkg={pkg} />
        <div className="scan-action">
          <p className="eyebrow">
            {pkg.reportId
              ? "Evidence available"
              : pkg.scanId
                ? "Scan in progress"
                : "Ready to inspect"}
          </p>
          <h2>
            {pkg.reportId ? "Open the stored observations." : "Compare loading across runtimes."}
          </h2>
          {pkg.reportId ? (
            <a className="button" href={`/reports/${pkg.reportId}`}>
              View report
            </a>
          ) : pkg.scanId ? (
            <a className="button" href={`/scans/${pkg.scanId}`}>
              View scan progress
            </a>
          ) : (
            <RequestScan name={pkg.name} version={pkg.version} enabled={pkg.scansEnabled} />
          )}
        </div>
      </div>
      <p>
        <a href={`/history?${new URLSearchParams({ name: pkg.name })}`}>
          Browse report history and comparisons
        </a>
      </p>
      <aside className="notice">
        <h2>What this scan observes</h2>
        <p>
          Shared npm preparation with scripts disabled; fresh ESM and CommonJS root checks; explicit
          subpaths in ordered batches. The report records omitted coverage and exact runtime images.
          It does not call arbitrary package functions.
        </p>
        <a href="/methodology">Read the methodology →</a>
      </aside>
    </section>
  );
}
