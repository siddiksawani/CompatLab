import { describe, expect, it } from "vitest";
import { runtimeMatrixSchema } from "../src/runtime.js";

const image = (index: number) => ({
  profileId: `node_${index}`,
  kind: "node",
  version: `${index}.0.0`,
  imageId: `sha256:${index.toString(16).padStart(64, "0")}`,
  builtAt: "2026-10-03T00:00:00.000Z",
  sourceImage: `node@sha256:${"a".repeat(64)}`,
  baseImage: `base@sha256:${"b".repeat(64)}`,
  platform: "linux_amd64_glibc",
  recipeRevision: "runtime_image_v1",
});
describe("runtime matrix identity", () => {
  it.each([1, 3, 5])("accepts %i immutable runtime images without fixed Node slots", (count) => {
    expect(
      runtimeMatrixSchema.parse(Array.from({ length: count }, (_, index) => image(index + 1))),
    ).toHaveLength(count);
  });
  it("rejects duplicate profiles, image reuse, floating tags and unsupported platforms", () => {
    for (const values of [
      [],
      [image(1), image(1)],
      [image(1), { ...image(2), imageId: image(1).imageId }],
      [{ ...image(1), sourceImage: "node:latest" }],
      [{ ...image(1), platform: "linux_arm64" }],
    ])
      expect(runtimeMatrixSchema.safeParse(values).success).toBe(false);
  });
});
