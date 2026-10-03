import { describe, expect, it } from "vitest";
import { inspectDocker } from "../src/doctor.js";

const supported = {
  OSType: "linux",
  Architecture: "x86_64",
  Runtimes: { runsc: { path: "/usr/local/bin/runsc" } },
};

describe("Docker prerequisites", () => {
  it.each(["amd64", "x86_64"])(
    "recognizes %s without claiming security qualification",
    async (arch) => {
      const result = await inspectDocker(async () =>
        JSON.stringify({ ...supported, Architecture: arch }),
      );
      expect(result.prerequisitesAvailable).toBe(true);
      expect(result.qualifiedForUntrustedCode).toBe(false);
    },
  );

  it.each([
    { OSType: "windows" },
    { Architecture: "aarch64" },
    { Runtimes: { runc: { path: "runc" } } },
    { Runtimes: { runsc: null } },
    { Runtimes: { runsc: { path: "" } } },
    { Runtimes: [] },
  ])("refuses unsupported or incomplete configuration: %j", async (change) => {
    const result = await inspectDocker(async () => JSON.stringify({ ...supported, ...change }));
    expect(result.prerequisitesAvailable).toBe(false);
  });

  it.each(["not json", "null", "[]", "{}"])(
    'refuses invalid Docker output "%s"',
    async (output) => {
      expect((await inspectDocker(async () => output)).prerequisitesAvailable).toBe(false);
    },
  );

  it("returns a useful unavailable result without leaking command errors", async () => {
    const result = await inspectDocker(async () => {
      throw new Error("private Docker endpoint and credentials");
    });
    expect(result.prerequisitesAvailable).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("credentials");
  });
});
