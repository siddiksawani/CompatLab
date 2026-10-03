import { type DoctorReport, inspectDocker } from "@compatlab/worker";

const usage = `Usage: compatlab doctor [--json]
       compatlab --help

doctor inspects Docker prerequisites without executing package code.
Package scanning is not available in this foundation release.
`;

type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export async function runCli(
  args: readonly string[],
  io: CliIO,
  doctor: () => Promise<DoctorReport> = inspectDocker,
): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    io.stdout(usage);
    return 0;
  }

  if (args[0] !== "doctor" || args.length > 2 || (args.length === 2 && args[1] !== "--json")) {
    io.stderr(usage);
    return 2;
  }

  const report = await doctor();
  if (args[1] === "--json") {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const check of report.checks) {
      io.stdout(`${check.available ? "Available" : "Unavailable"}: ${check.detail}\n`);
    }
    io.stdout("Prerequisite detection does not qualify a host for untrusted package execution.\n");
  }
  return report.prerequisitesAvailable ? 0 : 1;
}
