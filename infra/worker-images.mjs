import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PREPARATION_PROFILE_REVISION,
  PROBE_HARNESS_REVISION,
  PROBE_PLAN_REVISION,
  PROBE_POLICY_REVISION,
} from "../packages/contracts/dist/index.js";
import { buildRuntimeImages } from "../services/worker/dist/index.js";

const directory = process.argv[2];
if (!directory) throw new Error("Pass an existing private export directory.");
const images = await buildRuntimeImages();
for (const [index, image] of images.entries())
  await writeFile(join(directory, `runtime-${index}.json`), JSON.stringify(image, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
await writeFile(
  join(directory, "worker-capabilities.json"),
  JSON.stringify(
    {
      capacity: 1,
      capabilities: {
        platform: "linux_amd64_glibc",
        preparationProfiles: [PREPARATION_PROFILE_REVISION],
        imageDigests: images.map((image) => image.imageId),
        harnessRevision: PROBE_HARNESS_REVISION,
        planRevision: PROBE_PLAN_REVISION,
        policyRevision: PROBE_POLICY_REVISION,
      },
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
);
