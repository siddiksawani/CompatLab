import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_LOCK_BYTES, validateLock } from "../src/preparation/lock.js";

const integrity = `sha512-${createHash("sha512").update("fixture").digest("base64")}`;
const artifact = {
  name: "@scope/root",
  version: "1.0.0",
  integrity,
  tarballUrl: "https://registry.npmjs.org/@scope/root/-/root-1.0.0.tgz",
};
const rootEntry = { version: "1.0.0", resolved: artifact.tarballUrl, integrity };
const bytes = (extra: Record<string, unknown> = {}, root = rootEntry) =>
  Buffer.from(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { [artifact.name]: artifact.version } },
        [`node_modules/${artifact.name}`]: root,
        ...extra,
      },
    }),
  );

describe("frozen npm lock policy", () => {
  it("retains exact lock identity and optional, alias, bundled and script observations", () => {
    const result = validateLock(
      bytes({
        "node_modules/alias": { ...rootEntry, name: "actual-name", hasInstallScript: true },
        "node_modules/platform": { ...rootEntry, optional: true },
        "node_modules/@scope/root/node_modules/bundled": { version: "1.2.3", inBundle: true },
      }),
      artifact,
    );
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "node_modules/alias", hasInstallScript: true }),
        expect.objectContaining({ location: "node_modules/platform", optional: true }),
        expect.objectContaining({
          location: "node_modules/@scope/root/node_modules/bundled",
          bundled: true,
        }),
      ]),
    );
    expect(validateLock(Buffer.from(`${bytes()}\n`), artifact).digest).not.toBe(
      validateLock(bytes(), artifact).digest,
    );
  });

  it.each([
    "file:../escape",
    "git+https://github.com/example/pkg.git",
    "https://evil.example/pkg.tgz",
    "https://user@registry.npmjs.org/a.tgz",
  ])("rejects source %s before installation", (resolved) => {
    expect(() =>
      validateLock(bytes({ "node_modules/dep": { ...rootEntry, resolved } }), artifact),
    ).toThrow(expect.objectContaining({ classification: "dependency_source_unsupported" }));
  });

  it.each([
    "../escape",
    "node_modules/a/../../escape",
    "node_modules/a\\escape",
    "node_modules/@scope/root/node_modules/../escape",
  ])("rejects a non-package installation path %s", (location) => {
    expect(() => validateLock(bytes({ [location]: rootEntry }), artifact)).toThrow();
  });

  it.each([
    { version: "1.0.0", link: true },
    { version: "file:../local" },
    { version: "1.0.0", inBundle: true },
  ])("rejects unverified or linked records", (entry) => {
    expect(() => validateLock(bytes({ "node_modules/dep": entry }), artifact)).toThrow(
      expect.objectContaining({ classification: "dependency_source_unsupported" }),
    );
  });

  it("rejects changed root integrity and absent transitive integrity", () => {
    expect(() =>
      validateLock(
        bytes({}, { ...rootEntry, integrity: `sha512-${Buffer.alloc(64).toString("base64")}` }),
        artifact,
      ),
    ).toThrow(expect.objectContaining({ classification: "artifact_integrity_mismatch" }));
    expect(() =>
      validateLock(
        bytes({ "node_modules/dep": { version: "1.0.0", resolved: artifact.tarballUrl } }),
        artifact,
      ),
    ).toThrow(expect.objectContaining({ classification: "artifact_integrity_unavailable" }));
  });

  it("bounds lock bytes and rejects an unexpected consumer", () => {
    expect(() => validateLock(Buffer.alloc(MAX_LOCK_BYTES + 1), artifact)).toThrow(
      expect.objectContaining({ classification: "preparation_limit_exceeded" }),
    );
    expect(() =>
      validateLock(Buffer.from('{"lockfileVersion":2,"packages":{}}'), artifact),
    ).toThrow();
    expect(() => validateLock(bytes(), { ...artifact, version: "2.0.0" })).toThrow();
  });
});
