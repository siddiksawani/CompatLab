import { execFileSync } from "node:child_process";
import type { DoctorReport } from "@compatlab/worker";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

const report: DoctorReport = {
  schemaVersion: 1,
  prerequisitesAvailable: true,
  qualifiedForUntrustedCode: false,
  checks: [{ name: "docker", available: true, detail: "Docker is reachable." }],
};

function setup() {
  return { stdout: vi.fn<(text: string) => void>(), stderr: vi.fn<(text: string) => void>() };
}

describe("CLI", () => {
  it("emits a machine-readable doctor report and exits successfully", async () => {
    const io = setup();
    expect(await runCli(["doctor", "--json"], io, async () => report)).toBe(0);
    expect(JSON.parse(io.stdout.mock.calls[0]?.[0] ?? "")).toEqual(report);
    expect(io.stderr).not.toHaveBeenCalled();
  });

  it("returns a nonzero exit when sandbox prerequisites are missing", async () => {
    const io = setup();
    expect(
      await runCli(["doctor"], io, async () => ({ ...report, prerequisitesAvailable: false })),
    ).toBe(1);
    expect(io.stdout.mock.calls.flat().join("")).toContain("does not qualify a host");
  });

  it.each([
    ["check", "some-package"],
    ["ci", "package@1.0.0"],
    ["ci", "package@1.0.0", "--artifact", "a.tgz"],
    ["doctor", "--unsafe-local"],
    ["doctor", "--json", "extra"],
  ])("rejects unsupported arguments without invoking Docker: %j", async (...args) => {
    const io = setup();
    const doctor = vi.fn(async () => report);
    expect(await runCli(args, io, doctor)).toBe(2);
    expect(doctor).not.toHaveBeenCalled();
    expect(io.stderr).toHaveBeenCalled();
  });

  it("shows help without contacting Docker", async () => {
    const io = setup();
    const doctor = vi.fn(async () => report);
    expect(await runCli(["--help"], io, doctor)).toBe(0);
    expect(doctor).not.toHaveBeenCalled();
  });

  it.each(["check", "reproduce"])(
    "explains missing prerequisites before %s without running package code",
    async (command) => {
      const check = vi.fn();
      const reproduce = vi.fn();
      const io = setup();
      expect(
        await runCli(
          [command, command === "check" ? "@scope/package@1.0.0" : "report.json", "--json"],
          io,
          async () => ({
            ...report,
            prerequisitesAvailable: false,
            checks: [
              ...report.checks,
              {
                name: "runsc",
                available: false,
                detail: "Docker has no registered runsc runtime.",
              },
            ],
          }),
          { check, reproduce },
        ),
      ).toBe(3);
      expect(check).not.toHaveBeenCalled();
      expect(reproduce).not.toHaveBeenCalled();
      expect(io.stdout).not.toHaveBeenCalled();
      const error = io.stderr.mock.calls.flat().join("");
      expect(error).toContain("Docker has no registered runsc runtime.");
      expect(error).toContain("https://compatlab.me/methodology#local-cli");
      expect(error).not.toContain("Docker is reachable.");
    },
  );

  it.each([
    ["check", "package@^1.0.0"],
    ["check", "package@1.0.0", "--matrix", "arbitrary"],
    ["check", "package@1.0.0", "--unsafe-local"],
    ["check", "package@1.0.0", "--rebuild"],
    ["reproduce", "https://example.com/report.json"],
    ["reproduce", "report.json", "--json", "--json"],
    ["reproduce", "report.json", "--lockfile", "package-lock.json"],
  ])("rejects unsupported execution choices before host checks: %j", async (...args) => {
    const doctor = vi.fn(async () => report);
    expect(await runCli(args, setup(), doctor)).toBe(2);
    expect(doctor).not.toHaveBeenCalled();
  });

  it("runs the compiled entry point", () => {
    const output = execFileSync(process.execPath, ["apps/cli/dist/bin.js", "--help"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(output).toContain("Usage: compatlab doctor");
  });
});

it("refuses CI archive execution when runsc prerequisites are unavailable", async () => {
  const ci = vi.fn();
  expect(
    await runCli(
      ["ci", "fixture@1.0.0", "--artifact", "fixture.tgz", "--provenance", "provenance.json"],
      setup(),
      async () => ({ ...report, prerequisitesAvailable: false }),
      { check: vi.fn(), reproduce: vi.fn(), ci },
    ),
  ).toBe(3);
  expect(ci).not.toHaveBeenCalled();
});
