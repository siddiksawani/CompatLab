import type { RuntimeImage } from "@compatlab/contracts";
import { expect, it } from "vitest";
import { badgeGroupCount, badgeMarkdown, loadingBadge } from "../src/server/loading-badge.js";

it("keeps exact outcomes and versions across a sixteen-profile matrix", () => {
  const images = Array.from(
    { length: 16 },
    (_, i): RuntimeImage => ({
      profileId: `node_${i}`,
      kind: "node",
      version: `24.${i}.0`,
      imageId: `sha256:${i.toString(16).padStart(64, "0")}`,
      builtAt: "2026-11-13T00:00:00Z",
      sourceImage: "node",
      baseImage: "debian",
      supportImage: "node",
      platform: "linux_amd64_glibc",
      recipeRevision: "runtime_image_v1",
    }),
  );
  const evidence: Parameters<typeof loadingBadge>[0] = {
    observedAt: "2026-11-13T00:00:00Z",
    preparation: { outcome: "pass" },
    matrix: {
      images,
      id: "9b4bc2e3-9687-4966-82a5-39f7ae63058c",
      revision: "test",
      platform: "linux_amd64_glibc",
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
    },
    cells: images.map(({ profileId }, i) => ({
      profileId,
      group: "root",
      mode: "esm",
      outcome: i === 15 ? "fail" : "pass",
    })),
  };
  expect(badgeGroupCount(evidence)).toBe(4);
  const badges = Array.from({ length: 4 }, (_, i) => loadingBadge(evidence, "import", i + 1));
  const messages = badges.flatMap(({ message }) => message.split(" · "));
  expect(messages).toEqual(
    images.map(({ version }, i) => `Node ${version} ${i === 15 ? "fail" : "pass"}`),
  );
  expect(badges.map(({ color }) => color)).toEqual(["green", "green", "green", "yellow"]);
  expect(badges.every(({ message }) => message.length <= 255)).toBe(true);
  const markdown = badgeMarkdown("https://compatlab.me", evidence.matrix.id, "require", 4);
  const image = new URL(markdown.match(/\]\((https:\/\/img\.shields\.io\/[^)]+)\)/)?.[1] ?? "");
  const endpoint = new URL(image.searchParams.get("url") ?? "");
  expect(endpoint.pathname).toBe(`/api/v1/badges/${evidence.matrix.id}/shields`);
  expect(endpoint.searchParams.get("group")).toBe("4");
  expect(endpoint.searchParams.get("mode")).toBe("require");
  expect(markdown.endsWith(`](https://compatlab.me/reports/${evidence.matrix.id})`)).toBe(true);
});
