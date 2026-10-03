import {
  checkPackage,
  type DoctorReport,
  inspectDocker,
  parsePackageSpec,
  reproduceReport,
} from "@compatlab/worker";
import { runAdmin } from "./admin.js";
import { runBackup } from "./backup.js";

const usage = `Usage: compatlab doctor [--json]
       compatlab check package@exact-version [--matrix initial_v1] [--state-dir PATH] [--json]
       compatlab reproduce report.json [--rebuild] [--lockfile PATH] [--state-dir PATH] [--json]
       compatlab admin --help
       compatlab backup encrypt|decrypt INPUT OUTPUT KEY_FILE
       compatlab --help

Execution requires a local Linux amd64/runsc host with root privileges.
Reproduction verifies the retained snapshot; --rebuild creates a new generation from the retained lock.
`;
type CliIO = { stdout: (text: string) => void; stderr: (text: string) => void };
type Operations = { check: typeof checkPackage; reproduce: typeof reproduceReport };

export async function runCli(
  args: readonly string[],
  io: CliIO,
  doctor: () => Promise<DoctorReport> = inspectDocker,
  operations: Operations = { check: checkPackage, reproduce: reproduceReport },
  signal?: AbortSignal,
): Promise<number> {
  if (args[0] === "admin") return runAdmin(args.slice(1), io);
  if (args[0] === "backup") return runBackup(args.slice(1), io);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    io.stdout(usage);
    return 0;
  }
  if (args[0] === "doctor") {
    if (args.length > 2 || (args.length === 2 && args[1] !== "--json")) {
      io.stderr(usage);
      return 2;
    }
    const report = await doctor();
    if (args[1] === "--json") io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const check of report.checks)
        io.stdout(`${check.available ? "Available" : "Unavailable"}: ${check.detail}\n`);
      io.stdout(
        "Prerequisite detection does not qualify a host for untrusted package execution.\n",
      );
    }
    return report.prerequisitesAvailable ? 0 : 1;
  }
  let options: { stateDirectory: string; json: boolean; rebuild: boolean; lockFile?: string };
  try {
    options = argumentsForScan(args);
  } catch {
    io.stderr(usage);
    return 2;
  }
  try {
    if (!(await doctor()).prerequisitesAvailable) {
      io.stderr("The required Linux amd64/runsc backend is unavailable.\n");
      return 3;
    }
    const input = args[1];
    if (!input) return 2;
    const execution = { stateDirectory: options.stateDirectory, ...(signal ? { signal } : {}) };
    const report =
      args[0] === "check"
        ? await operations.check(input, execution)
        : await operations.reproduce(input, {
            ...execution,
            rebuild: options.rebuild,
            ...(options.lockFile ? { lockFile: options.lockFile } : {}),
          });
    if (options.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    else {
      io.stdout(
        `${report.artifact.name}@${report.artifact.version}: ${report.reproduction.method}\n`,
      );
      for (const group of report.groups) {
        const failures = group.observations.filter((entry) => entry.outcome === "fail").length;
        io.stdout(
          `${group.profileId} ${group.group}/${group.mode}: ${group.coverage.observed}/${group.coverage.planned} observed, ${failures} failed, ${group.coverage.interrupted} interrupted, ${group.coverage.untested} untested\n`,
        );
      }
      io.stdout(`Report: ${options.stateDirectory}/reports/${report.id}.json\n`);
    }
    return !report.deadlineReached &&
      !report.cancelled &&
      report.groups.every(
        (group) =>
          group.coverage.complete && group.observations.every((entry) => entry.outcome === "pass"),
      )
      ? 0
      : 1;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : "Execution failed."}\n`);
    return 3;
  }
}

function argumentsForScan(args: readonly string[]) {
  if ((args[0] !== "check" && args[0] !== "reproduce") || !args[1] || args[1].startsWith("-"))
    throw new TypeError();
  if (args[0] === "check") parsePackageSpec(args[1]);
  else if (/^https?:/i.test(args[1])) throw new TypeError();
  const options: { stateDirectory: string; json: boolean; rebuild: boolean; lockFile?: string } = {
    stateDirectory: "/var/lib/compatlab",
    json: false,
    rebuild: false,
  };
  const seen = new Set<string>();
  for (let index = 2; index < args.length; index++) {
    const key = args[index];
    if (!key || seen.has(key)) throw new TypeError();
    seen.add(key);
    if (key === "--json") options.json = true;
    else if (key === "--rebuild" && args[0] === "reproduce") options.rebuild = true;
    else if (
      key === "--state-dir" ||
      (key === "--matrix" && args[0] === "check") ||
      (key === "--lockfile" && args[0] === "reproduce")
    ) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new TypeError();
      if (key === "--matrix" && value !== "initial_v1") throw new TypeError();
      if (key === "--state-dir") options.stateDirectory = value;
      if (key === "--lockfile") options.lockFile = value;
    } else throw new TypeError();
  }
  if (options.lockFile && !options.rebuild) throw new TypeError();
  return options;
}
