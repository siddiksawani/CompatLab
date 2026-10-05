import type { RuntimeImage } from "@compatlab/contracts";
import { RUNTIME_BASE_IMAGE, RUNTIME_SUPPORT_IMAGE, runtimeProfile } from "@compatlab/engine";
import { expect, it, vi } from "vitest";
import { docker } from "../src/command.js";
import { verifyRuntimeImages } from "../src/runtime/images.js";

vi.mock("../src/command.js", () => ({ docker: vi.fn() }));

const profile = runtimeProfile("node_24_21_0");
const image: RuntimeImage = {
  profileId: profile.id,
  kind: profile.kind,
  version: profile.version,
  sourceImage: profile.sourceImage,
  baseImage: RUNTIME_BASE_IMAGE,
  supportImage: RUNTIME_SUPPORT_IMAGE,
  imageId: `sha256:${"a".repeat(64)}`,
  builtAt: "2026-10-05T00:00:00.000Z",
  platform: "linux_amd64_glibc",
  recipeRevision: "runtime_image_v1",
};

it("explains a missing exact image without building or pulling a substitute", async () => {
  vi.mocked(docker).mockRejectedValueOnce({ stderr: `Error: No such image: ${image.imageId}` });
  await expect(verifyRuntimeImages([image])).rejects.toThrow(
    `Required runtime image ${image.imageId} (${image.profileId}) is missing.`,
  );
  expect(docker).toHaveBeenCalledTimes(1);
  expect(docker).toHaveBeenCalledWith([
    "image",
    "inspect",
    "--format",
    "{{.Os}}/{{.Architecture}}",
    image.imageId,
  ]);
});

it("preserves Docker failures other than a missing image", async () => {
  const unavailable = new Error("Cannot connect to Docker.");
  vi.mocked(docker).mockRejectedValueOnce(unavailable);
  await expect(verifyRuntimeImages([image])).rejects.toBe(unavailable);
});

it("still rejects an image with mismatched recipe labels", async () => {
  vi.mocked(docker).mockResolvedValueOnce("linux/amd64").mockResolvedValueOnce("{}");
  await expect(verifyRuntimeImages([image])).rejects.toThrow(
    "Runtime image labels do not match the approved recipe.",
  );
});
