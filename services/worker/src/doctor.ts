import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type DoctorCheck = {
  name: "docker" | "platform" | "runsc";
  available: boolean;
  detail: string;
};

export type DoctorReport = {
  schemaVersion: 1;
  prerequisitesAvailable: boolean;
  qualifiedForUntrustedCode: false;
  checks: DoctorCheck[];
};

export async function readDockerInfo(): Promise<string> {
  const { stdout } = await exec("docker", ["info", "--format", "{{json .}}"], {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

export async function inspectDocker(
  readInfo: () => Promise<string> = readDockerInfo,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let info: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(await readInfo());
    if (!isRecord(raw)) throw new Error("Invalid Docker response");
    info = raw;
    checks.push({ name: "docker", available: true, detail: "Docker is reachable." });
  } catch {
    return {
      schemaVersion: 1,
      prerequisitesAvailable: false,
      qualifiedForUntrustedCode: false,
      checks: [
        {
          name: "docker",
          available: false,
          detail: "Docker is unavailable or returned invalid data.",
        },
      ],
    };
  }

  const supportedPlatform =
    info.OSType === "linux" && (info.Architecture === "x86_64" || info.Architecture === "amd64");
  checks.push({
    name: "platform",
    available: supportedPlatform,
    detail: supportedPlatform
      ? "The Docker server runs Linux amd64."
      : "The initial sandbox profile requires a Linux amd64 Docker server.",
  });

  const hasRunsc =
    isRecord(info.Runtimes) &&
    Object.hasOwn(info.Runtimes, "runsc") &&
    isRecord(info.Runtimes.runsc) &&
    typeof info.Runtimes.runsc.path === "string" &&
    info.Runtimes.runsc.path.trim().length > 0;
  checks.push({
    name: "runsc",
    available: hasRunsc,
    detail: hasRunsc ? "A runsc runtime is registered." : "Docker has no registered runsc runtime.",
  });

  return {
    schemaVersion: 1,
    prerequisitesAvailable: checks.every((check) => check.available),
    qualifiedForUntrustedCode: false,
    checks,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
