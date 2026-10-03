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

  it("runs the compiled entry point", () => {
    const output = execFileSync(process.execPath, ["apps/cli/dist/bin.js", "--help"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(output).toContain("Usage: compatlab doctor");
  });
});
