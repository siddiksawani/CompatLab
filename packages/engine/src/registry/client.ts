import { rcompare } from "semver";
import { RegistryError } from "./errors.js";
import { RegistryHttp, type RegistryHttpOptions } from "./http.js";
import {
  artifactIntegrity,
  assertPackageName,
  assertSelector,
  isDistTag,
  isExactVersion,
  isRecord,
  REGISTRY_ORIGIN,
  registryTarballUrl,
} from "./validation.js";

export type PackageSummary = {
  name: string;
  version: string;
  description?: string;
  repositoryUrl?: string;
};
export type ResolvedArtifact = {
  name: string;
  version: string;
  tarballUrl: string;
  integrity: string;
  observedTags: Record<string, string>;
  manifest: Record<string, unknown>;
};

const ABBREVIATED = "application/vnd.npm.install-v1+json";

export class RegistryClient {
  private readonly http: RegistryHttp;

  constructor(options: RegistryHttpOptions = {}) {
    this.http = new RegistryHttp(options);
  }

  async search(query: string, limit = 10, signal?: AbortSignal): Promise<PackageSummary[]> {
    if (
      !query.trim() ||
      query.length > 200 ||
      [...query].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    ) {
      throw new TypeError("Search requires 1–200 characters and a result limit between 1 and 20.");
    }
    const url = new URL("/-/v1/search", REGISTRY_ORIGIN);
    url.searchParams.set("text", query);
    url.searchParams.set("size", String(limit));
    const result = await this.http.json(url, {
      maxBytes: 1024 * 1024,
      accept: "application/json",
      notFound: "package_not_found",
      ...(signal ? { signal } : {}),
    });
    if (!isRecord(result) || !Array.isArray(result.objects)) return invalidManifest();
    const summaries: PackageSummary[] = [];
    for (const object of result.objects.slice(0, limit)) {
      if (!isRecord(object) || !isRecord(object.package)) continue;
      const pkg = object.package;
      if (typeof pkg.name !== "string" || !isExactVersion(pkg.version)) continue;
      try {
        assertPackageName(pkg.name);
      } catch {
        continue;
      }
      const summary: PackageSummary = { name: pkg.name, version: pkg.version };
      if (typeof pkg.description === "string") summary.description = pkg.description.slice(0, 4096);
      const repository = isRecord(pkg.links) ? pkg.links.repository : undefined;
      if (typeof repository === "string" && repository.length <= 2048) {
        const parsed = URL.parse(repository);
        if (
          parsed &&
          ["http:", "https:"].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password
        )
          summary.repositoryUrl = parsed.href;
      }
      summaries.push(summary);
    }
    return summaries;
  }

  async versions(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ versions: string[]; tags: Record<string, string> }> {
    assertPackageName(name);
    const result = await this.http.json(new URL(`/${encodeURIComponent(name)}`, REGISTRY_ORIGIN), {
      maxBytes: 32 * 1024 * 1024,
      accept: ABBREVIATED,
      notFound: "package_not_found",
      ...(signal ? { signal } : {}),
    });
    if (!isRecord(result) || result.name !== name || !isRecord(result.versions))
      return invalidManifest();
    const tags: Record<string, string> = {};
    if (isRecord(result["dist-tags"])) {
      for (const [tag, version] of Object.entries(result["dist-tags"])) {
        if (isDistTag(tag) && isExactVersion(version))
          Object.defineProperty(tags, tag, { value: version, enumerable: true });
      }
    }
    return { versions: Object.keys(result.versions).filter(isExactVersion).sort(rcompare), tags };
  }

  async resolve(
    name: string,
    selector = "latest",
    signal?: AbortSignal,
  ): Promise<ResolvedArtifact> {
    assertPackageName(name);
    assertSelector(selector);
    const observedTags = isExactVersion(selector) ? {} : (await this.versions(name, signal)).tags;
    const version = isExactVersion(selector)
      ? selector
      : Object.hasOwn(observedTags, selector)
        ? observedTags[selector]
        : undefined;
    if (!version)
      throw new RegistryError(
        "package_version_not_found",
        "The requested dist-tag is unavailable.",
      );
    const manifest = await this.http.json(
      new URL(`/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, REGISTRY_ORIGIN),
      {
        maxBytes: 2 * 1024 * 1024,
        accept: "application/json",
        // npm sometimes labels selected-version JSON as plain text.
        allowPlainTextJson: true,
        notFound: "package_version_not_found",
        ...(signal ? { signal } : {}),
      },
    );
    if (
      !isRecord(manifest) ||
      manifest.name !== name ||
      manifest.version !== version ||
      !isRecord(manifest.dist)
    )
      return invalidManifest();
    return {
      name,
      version,
      tarballUrl: registryTarballUrl(manifest.dist.tarball),
      integrity: artifactIntegrity(manifest.dist.integrity),
      observedTags,
      manifest,
    };
  }
}

function invalidManifest(): never {
  throw new RegistryError(
    "package_manifest_invalid",
    "The registry returned inconsistent package metadata.",
  );
}
