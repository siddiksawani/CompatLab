import { isAbsolute } from "node:path";
import type { RuntimeImage } from "@compatlab/contracts";
import { RUNTIME_ENVIRONMENT, runtimeProfile } from "@compatlab/engine";

export function runtimeContainerArguments(options: {
  name: string;
  image: RuntimeImage;
  workspace: string;
  harness: string;
  output: string;
  operation?: "run" | "create";
}): string[] {
  const { name, image, workspace, harness, output } = options;
  if (!/^compatlab-runtime-[a-z0-9-]+$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(image.imageId))
    throw new TypeError("Invalid runtime identity.");
  for (const path of [workspace, harness, output])
    if (!isAbsolute(path) || /[,\r\n]/.test(path))
      throw new TypeError("Runtime mounts require unambiguous absolute paths.");
  return [
    options.operation ?? "run",
    "--name",
    name,
    "--label=compatlab.managed=true",
    "--pull=never",
    "--runtime=runsc",
    "--network=none",
    "--read-only",
    "--user=65534:65534",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=1g",
    "--memory-swap=1g",
    "--cpus=1",
    "--pids-limit=128",
    "--ulimit=nproc=128:128",
    "--ulimit=core=0:0",
    "--log-driver=none",
    "--workdir=/workspace",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=64m",
    "--mount",
    `type=bind,src=${workspace},dst=/workspace,readonly`,
    "--mount",
    `type=bind,src=${harness},dst=/workspace/.compatlab,readonly`,
    "--mount",
    `type=bind,src=${output},dst=/output`,
    ...Object.entries(RUNTIME_ENVIRONMENT).map(([key, value]) => `--env=${key}=${value}`),
    "--entrypoint",
    runtimeProfile(image.profileId).binary,
    image.imageId,
  ];
}
