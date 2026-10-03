import { fileURLToPath } from "node:url";
import { type RuntimeImage, runtimeImageSchema, runtimeMatrixSchema } from "@compatlab/contracts";
import {
  RUNTIME_BASE_IMAGE,
  RUNTIME_PROFILES,
  RUNTIME_SUPPORT_IMAGE,
  runtimeProfile,
} from "@compatlab/engine";
import { docker } from "../command.js";
import { assertPreparationHost } from "../preparation/prepare.js";

export async function buildRuntimeImages(
  ids = RUNTIME_PROFILES.map((profile) => profile.id),
): Promise<RuntimeImage[]> {
  await assertPreparationHost();
  if (ids.length < 1 || ids.length > 16 || new Set(ids).size !== ids.length)
    throw new TypeError("Select distinct runtime profiles.");
  const profiles = ids.map(runtimeProfile);
  const images: RuntimeImage[] = [];
  for (const profile of profiles) {
    const imageId = await docker(
      [
        "build",
        "--quiet",
        "--platform=linux/amd64",
        "--network=none",
        "--build-arg",
        `SOURCE_IMAGE=${profile.sourceImage}`,
        "--build-arg",
        `RUNTIME_BINARY=${profile.binary}`,
        "--build-arg",
        `PROFILE_ID=${profile.id}`,
        fileURLToPath(new URL("../../../../runtime-images", import.meta.url)),
      ],
      180_000,
    );
    const builtAt = await docker(["image", "inspect", "--format", "{{.Created}}", imageId]);
    images.push(
      runtimeImageSchema.parse({
        profileId: profile.id,
        kind: profile.kind,
        version: profile.version,
        imageId,
        builtAt: new Date(builtAt).toISOString(),
        sourceImage: profile.sourceImage,
        baseImage: RUNTIME_BASE_IMAGE,
        supportImage: RUNTIME_SUPPORT_IMAGE,
        platform: "linux_amd64_glibc",
        recipeRevision: "runtime_image_v1",
      }),
    );
  }
  return runtimeMatrixSchema.parse(images);
}

export async function verifyRuntimeImages(images: readonly RuntimeImage[]): Promise<void> {
  runtimeMatrixSchema.parse(images);
  for (const image of images) {
    const profile = runtimeProfile(image.profileId);
    if (
      image.sourceImage !== profile.sourceImage ||
      image.baseImage !== RUNTIME_BASE_IMAGE ||
      image.supportImage !== RUNTIME_SUPPORT_IMAGE ||
      image.kind !== profile.kind ||
      image.version !== profile.version
    )
      throw new TypeError("Runtime image provenance does not match its approved profile.");
    const platform = await docker([
      "image",
      "inspect",
      "--format",
      "{{.Os}}/{{.Architecture}}",
      image.imageId,
    ]);
    if (platform !== "linux/amd64") throw new TypeError("Runtime images require Linux amd64.");
    const labels: Record<string, string> = JSON.parse(
      await docker(["image", "inspect", "--format", "{{json .Config.Labels}}", image.imageId]),
    );
    if (
      labels?.["compatlab.runtime.profile"] !== profile.id ||
      labels?.["compatlab.runtime.source"] !== profile.sourceImage ||
      labels?.["compatlab.runtime.recipe"] !== image.recipeRevision
    )
      throw new TypeError("Runtime image labels do not match the approved recipe.");
  }
}
