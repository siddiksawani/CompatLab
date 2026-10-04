import { createHash } from "node:crypto";
import type { CiArtifact } from "@compatlab/contracts";
import { describe, expect, it } from "vitest";
import { assertionBundle, assertionEvidence } from "../../../tests/assertion-fixtures.js";
import {
  assertionDigest,
  assertionPassed,
  classifyAssertion,
  validateAssertionBundle,
  verifyAssertionEvidence,
} from "../src/assertions.js";
import { CI_FILE_SPEC, validateLock } from "../src/preparation/lock.js";

it("identifies immutable source, fixtures, capabilities and harness inputs", () => {
  const a = assertionBundle("fixture", "export default ()=>{}", { "fixture.txt": "hello" });
  expect(assertionDigest(a)).toBe(assertionDigest({ ...a, files: [...a.files].reverse() }));
  expect(
    assertionDigest(assertionBundle("fixture", "export default ()=>{throw Error()}")),
  ).not.toBe(assertionDigest(a));
  expect(() =>
    validateAssertionBundle({
      ...a,
      files: a.files.map((f) => ({ ...f, sha256: "0".repeat(64) })),
    }),
  ).toThrow();
  expect(() =>
    validateAssertionBundle({ ...a, manifest: { ...a.manifest, fixtures: ["../secret"] } }),
  ).toThrow();
  expect(() =>
    validateAssertionBundle({
      ...a,
      manifest: { ...a.manifest, capabilities: { ...a.manifest.capabilities, network: "all" } },
    }),
  ).toThrow();
  expect(() => validateAssertionBundle(assertionBundle("fixture", "x".repeat(65537)))).toThrow();
});
it("never promotes incomplete, crashed or forged stdout observations", () => {
  const bundle = assertionBundle(),
    ok = assertionEvidence(bundle, "node_24_21_0"),
    fail = assertionEvidence(bundle, "node_24_21_0", true);
  expect(classifyAssertion(ok.profileId, null, ok)).toMatchObject({
    outcome: "pass",
    evidenceLevel: "probe_verified",
  });
  expect(classifyAssertion(fail.profileId, null, fail)).toMatchObject({
    outcome: "fail",
    evidenceLevel: "probe_verified",
    failure: { classification: "probe_assertion_failed" },
  });
  const interrupted = structuredClone(ok);
  interrupted.session.stopReason = "entry_timeout";
  expect(assertionPassed(interrupted)).toBe(false);
  expect(classifyAssertion(ok.profileId, null, interrupted).evidenceLevel).toBe("static_only");
  const forged = structuredClone(ok);
  forged.session.exitCode = 1;
  expect(() => verifyAssertionEvidence(forged, bundle.manifest.packageName)).toThrow();
  forged.session.checkpoint = null;
  forged.session.logs.stdout = JSON.stringify(ok);
  expect(() => verifyAssertionEvidence(forged, bundle.manifest.packageName)).toThrow();
});
it("rejects colliding fixture paths and aggregate payloads beyond the bundle limit", () => {
  expect(() =>
    validateAssertionBundle(
      assertionBundle("fixture", "export default ()=>{}", {
        "node_modules/fixture/index.js": "export default 'shadowed'",
      }),
    ),
  ).toThrow();
  expect(() =>
    validateAssertionBundle(
      assertionBundle("fixture", "export default ()=>{}", {
        "probe.mjs/child.txt": "collision",
      }),
    ),
  ).toThrow();
  expect(() =>
    validateAssertionBundle(
      assertionBundle("fixture", "export default ()=>{}", {
        "oversized.txt": "x".repeat(524289),
      }),
    ),
  ).toThrow();
  expect(() =>
    validateAssertionBundle(
      assertionBundle("fixture", "export default ()=>{}", {
        "a.txt": "x".repeat(524288),
        "b.txt": "x".repeat(524288),
        "c.txt": "x".repeat(524288),
        "d.txt": "x".repeat(524288),
      }),
    ),
  ).toThrow();
});
describe("CI root lock isolation", () => {
  const artifact: CiArtifact = {
    kind: "ci_artifact",
    name: "ci-fixture",
    version: "1.0.0",
    sha256: "1".repeat(64),
    integrity: `sha512-${createHash("sha512").update("fixture").digest("base64")}`,
    bytes: 7,
    provenance: {
      provider: "github_actions",
      confidence: "caller_supplied",
      repository: "owner/package",
      commit: "a".repeat(40),
      workflow: ".github/workflows/ci.yml",
      runId: "1",
      runAttempt: 1,
    },
  };
  const lock = () => ({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [artifact.name]: CI_FILE_SPEC } },
      [`node_modules/${artifact.name}`]: {
        version: "1.0.0",
        resolved: "file:../input/artifact.tgz",
        integrity: artifact.integrity,
      },
    },
  });
  it("permits only the exact root file and checks its integrity", () => {
    expect(validateLock(Buffer.from(JSON.stringify(lock())), artifact).dependencies).toHaveLength(
      1,
    );
    const changed = lock();
    changed.packages[`node_modules/${artifact.name}`] = {
      version: "1.0.0",
      resolved: "file:/tmp/other.tgz",
      integrity: artifact.integrity,
    };
    expect(() => validateLock(Buffer.from(JSON.stringify(changed)), artifact)).toThrow();
    expect(() =>
      validateLock(Buffer.from(JSON.stringify(lock())), {
        ...artifact,
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      }),
    ).toThrow();
  });
  it("does not widen the transitive dependency source policy", () => {
    const value = lock();
    Object.assign(value.packages, {
      "node_modules/transitive": {
        version: "1.0.0",
        resolved: CI_FILE_SPEC,
        integrity: artifact.integrity,
      },
    });
    expect(() => validateLock(Buffer.from(JSON.stringify(value)), artifact)).toThrow();
  });
});
