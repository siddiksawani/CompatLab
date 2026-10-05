import type { PackageResponse } from "@compatlab/contracts";

export function VersionPicker({ pkg }: { pkg: PackageResponse }) {
  const versions = [...new Set([pkg.version, ...pkg.versions])];
  return (
    <div>
      <h2>Select a published version</h2>
      <form action="/packages" className="version-form">
        <input type="hidden" name="name" value={pkg.name} />
        <label htmlFor="version">Exact version</label>
        <select id="version" name="version" defaultValue={pkg.version}>
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          Select version
        </button>
      </form>
      <p className="fine">
        {pkg.versionsTruncated
          ? "The menu includes the 200 most recent versions and your current selection."
          : "Choose a published version from the menu."}
      </p>
      <details className="manual-version">
        <summary>Enter another exact version</summary>
        <form action="/packages" className="version-form">
          <input type="hidden" name="name" value={pkg.name} />
          <label htmlFor="manual-version">Other exact version</label>
          <input
            id="manual-version"
            name="version"
            placeholder="e.g. 1.0.0"
            maxLength={256}
            required
          />
          <button type="submit" className="secondary">
            Open version
          </button>
        </form>
      </details>
      <p className="fine">
        Published tags:{" "}
        {Object.entries(pkg.tags)
          .map(([tag, value]) => `${tag} → ${value}`)
          .join(" · ") || "None supplied"}
      </p>
    </div>
  );
}
