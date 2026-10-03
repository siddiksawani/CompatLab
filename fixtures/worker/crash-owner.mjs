import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { docker } from "../../services/worker/dist/command.js";
import {
  createPreparationNetwork,
  ExecutionSupervisor,
  WorkspaceVolume,
} from "../../services/worker/dist/index.js";

const [state, workspace, imageFile] = process.argv.slice(2);
const supervisor = await ExecutionSupervisor.open(state);
const id = randomUUID();
const volume = await WorkspaceVolume.create(join(state, "snapshots", id), 64 * 1024 ** 2, 1024);
await mkdir(join(volume.path, "partial"));
await createPreparationNetwork(id, volume.directory);
const images = JSON.parse(await readFile(imageFile, "utf8"));
const backend = await supervisor.backend({ id, workspace }, images, randomUUID());
void backend.run(
  {
    schemaVersion: 2,
    probeId: randomUUID(),
    mode: "commonjs",
    group: "root",
    entries: ["compatlab-hostile-cpu"],
    startIndex: 0,
  },
  images[0],
  new AbortController().signal,
);
for (let attempt = 0; attempt < 50; attempt++) {
  if (
    (
      await docker(["ps", "--filter", "label=compatlab.managed=true", "--format", "{{.Names}}"])
    ).includes("compatlab-runtime-")
  ) {
    process.stdout.write("ready\n");
    break;
  }
  await delay(100);
}
setInterval(() => {}, 1000);
