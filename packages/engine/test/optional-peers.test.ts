import type { LoadObservation } from "@compatlab/contracts";
import { describe, expect, it } from "vitest";
import { classifyDiagnostic, classifyLoad, optionalPeerContext } from "../src/index.js";

const manifest = {
  name: "fixture",
  peerDependencies: { "@fixture/renderer": "^2.0.0", required: "*" },
  peerDependenciesMeta: { "@fixture/renderer": { optional: true } },
};
const context = optionalPeerContext("fixture", manifest, ["node_modules/fixture"]);

function failure(message: string, code: string | null = "ERR_MODULE_NOT_FOUND") {
  return {
    index: 0,
    outcome: "fail",
    resolvedTo: "file:///workspace/node_modules/fixture/server.mjs",
    durationMs: 1,
    error: { name: "Error", message, code },
  } satisfies LoadObservation;
}

describe("missing optional peer evidence", () => {
  it("does not accept a diagnostic label without corroborating preparation and load evidence", () => {
    expect(
      classifyDiagnostic({ classification: "optional_peer_missing", message: "Missing renderer" }),
    ).toMatchObject({ classification: "runner_unavailable", origin: "infrastructure" });
  });
  it.each([
    [
      "Cannot find package '@fixture/renderer' imported from /workspace/node_modules/fixture/server.mjs",
      "ERR_MODULE_NOT_FOUND",
    ],
    [
      "Cannot find module '@fixture/renderer'\nRequire stack:\n- /workspace/node_modules/fixture/server.js",
      "MODULE_NOT_FOUND",
    ],
    [
      "Could not find package '@fixture/renderer' from referrer 'file:///workspace/node_modules/fixture/server.mjs'.",
      "ERR_MODULE_NOT_FOUND",
    ],
    ["Cannot find module '@fixture/renderer/server'", "MODULE_NOT_FOUND"],
    ['renderToString() error: missing "@fixture/renderer" dependency.', null],
  ])("corroborates %s against the manifest and installed snapshot", (message, code) => {
    const observation = failure(message as string, code);
    const original = structuredClone(observation);
    expect(classifyLoad(observation, "esm", context)).toMatchObject({
      classification: "optional_peer_missing",
      origin: "prerequisite",
      phase: "module_resolution",
      retryable: false,
      optionalPeer: { name: "@fixture/renderer", range: "^2.0.0" },
    });
    expect(observation).toEqual(original);
  });

  it.each([
    "node_modules/@fixture/renderer",
    "node_modules/fixture/node_modules/@fixture/renderer",
    "node_modules/unrelated/node_modules/@fixture/renderer",
  ])("does not infer absence when the dependency exists at %s", (location) => {
    const installed = optionalPeerContext("fixture", manifest, ["node_modules/fixture", location]);
    expect(
      classifyLoad(
        failure("Cannot find module '@fixture/renderer/missing'", "MODULE_NOT_FOUND"),
        "commonjs",
        installed,
      ),
    ).toMatchObject({
      classification: "package_resolution_failed",
      origin: "package",
    });
  });

  it.each([
    undefined,
    [],
    ["node_modules/other"],
    ["node_modules/fixture", "../outside"],
    ["node_modules/fixture", null],
    ["node_modules/fixture", "node_modules/../renderer"],
  ])("does not treat missing or invalid inventory as an empty snapshot: %j", (installed) => {
    expect(optionalPeerContext("fixture", manifest, installed).size).toBe(0);
  });

  it.each([
    {},
    { ...manifest, name: "other" },
    { ...manifest, peerDependencies: {} },
    { ...manifest, peerDependenciesMeta: {} },
    { ...manifest, peerDependenciesMeta: { "@fixture/renderer": { optional: "true" } } },
    { ...manifest, peerDependencies: { "@fixture/renderer": "bad\nrange" } },
  ])("requires an explicit matching optional-peer declaration: %j", (declared) => {
    expect(optionalPeerContext("fixture", declared, ["node_modules/fixture"]).size).toBe(0);
  });

  it.each([
    ["Cannot find module 'required'", "MODULE_NOT_FOUND"],
    ["Cannot find module 'undeclared'", "MODULE_NOT_FOUND"],
    ["Cannot find module './@fixture/renderer'", "MODULE_NOT_FOUND"],
    ["Cannot find module '@fixture/renderer/../file'", "MODULE_NOT_FOUND"],
    ["Cannot find module '@fixture/renderer-extra'", "MODULE_NOT_FOUND"],
    ["Cannot find module '@fixture/renderer'", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
    ["Cannot find module '@fixture/renderer'", null],
    ['User input mentioned missing "@fixture/renderer" dependency.', null],
    ["@fixture/renderer needs document", null],
    ["", null],
  ])("leaves unrelated or insufficient evidence classified as a failure: %s", (message, code) => {
    const result = classifyLoad(failure(message as string, code), "esm", context);
    expect(result.origin).toBe("package");
    expect(result.optionalPeer).toBeUndefined();
  });

  it("explains absent diagnostics without inventing a cause", () => {
    expect(classifyLoad(failure("", null), "esm", context)).toMatchObject({
      classification: "esm_import_failed",
      message:
        "The runtime reported a loading failure without a captured error message. Its cause is unknown.",
    });
  });
});
