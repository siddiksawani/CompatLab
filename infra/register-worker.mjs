import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  openCatalog,
  registerMatrix,
  registerRuntime,
  registerWorker,
  updateWorkerDefinition,
} from "../packages/catalog/dist/index.js";
import { runtimeMatrixSchema, workerCapabilitiesSchema } from "../packages/contracts/dist/index.js";

const [inventoryFile, registrationFile] = process.argv.slice(2);
const raw = JSON.parse(await readFile(inventoryFile, "utf8"));
const images = runtimeMatrixSchema.parse(raw.images);
const capabilities = workerCapabilitiesSchema.parse(raw.capabilities);
if (
  raw.capacity !== 1 ||
  JSON.stringify(capabilities.imageDigests) !== JSON.stringify(images.map((image) => image.imageId))
)
  throw new Error("Worker inventory and image identities differ.");
const catalog = openCatalog((await readFile(process.env.ADMIN_DATABASE_URL_FILE, "utf8")).trim());
const actor = { actor: "production-deployment", reason: "Activate qualified worker inventory." };
try {
  const imageIds = [];
  for (const image of images) imageIds.push(await registerRuntime(catalog.db, image, actor));
  const definition = {
    preparationProfile: capabilities.preparationProfiles[0],
    harnessRevision: capabilities.harnessRevision,
    planRevision: capabilities.planRevision,
    policyRevision: capabilities.policyRevision,
    imageIds,
  };
  const revision = `production_${createHash("sha256").update(JSON.stringify(definition)).digest("hex").slice(0, 32)}`;
  const matrixId = await registerMatrix(catalog.db, { revision, ...definition }, actor);
  let registration;
  try {
    registration = JSON.parse(await readFile(registrationFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (registration)
    await updateWorkerDefinition(catalog.db, registration.workerId, capabilities, 1, actor);
  else {
    registration = await registerWorker(catalog.db, capabilities, 1, actor);
    await writeFile(registrationFile, JSON.stringify(registration), { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ workerId: registration.workerId, matrixId })}\n`);
} finally {
  await catalog.close();
}
