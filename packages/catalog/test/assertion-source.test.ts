import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { assertionBundle } from "../../../tests/assertion-fixtures.js";
import { fetchAssertionBundle } from "../src/assertions/source.js";

function github(mode = "100644", corrupt = false, truncated = false) {
  const bundle = assertionBundle("fixture", "export default ()=>{}", { "fixture.txt": "hello" });
  const manifest = Buffer.from(JSON.stringify(bundle.manifest));
  const manifestSha = createHash("sha1")
    .update(`blob ${manifest.length}\0`)
    .update(manifest)
    .digest("hex");
  const blobs = new Map([
    ...bundle.files.map((f) => [f.gitBlobSha, Buffer.from(f.base64, "base64")] as const),
    [manifestSha, manifest] as const,
  ]);
  const entries = [
    ...bundle.files.map((f) => ({
      path: f.path,
      sha: f.gitBlobSha,
      size: Buffer.from(f.base64, "base64").length,
    })),
    { path: "manifest.json", sha: manifestSha, size: manifest.length },
  ];
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = String(url);
    if (path.endsWith(`/commits/${bundle.commit}`))
      return Response.json({ sha: bundle.commit, tree: { sha: bundle.tree } });
    if (path.endsWith(`/trees/${bundle.tree}`))
      return Response.json({
        sha: bundle.tree,
        truncated,
        tree: entries.map((entry) => ({
          ...entry,
          type: "blob",
          mode: entry.path === "probe.mjs" ? mode : "100644",
        })),
      });
    const id = path.split("/").at(-1) ?? "",
      bytes = blobs.get(id);
    if (!bytes) return new Response("", { status: 404 });
    return Response.json({
      sha: id,
      encoding: "base64",
      size: bytes.length,
      content: corrupt ? "AA==" : bytes.toString("base64"),
    });
  });
  return { bundle, fetcher };
}
it("fetches exact Git objects and verifies source bytes without executing them", async () => {
  const { bundle, fetcher } = github();
  const result = await fetchAssertionBundle(
    bundle.repository,
    bundle.commit,
    bundle.manifestPath,
    "secret-token",
    fetcher,
  );
  expect(result).toEqual({
    ...bundle,
    files: [...bundle.files].sort((a, b) => a.path.localeCompare(b.path)),
  });
  expect(JSON.stringify(result)).not.toContain("secret-token");
  expect(fetcher).toHaveBeenCalledTimes(5);
});
it.each(["120000", "160000"])("rejects nonregular Git mode %s", async (mode) => {
  const { bundle, fetcher } = github(mode);
  await expect(
    fetchAssertionBundle(bundle.repository, bundle.commit, bundle.manifestPath, "token", fetcher),
  ).rejects.toThrow();
});
it("rejects moving refs, truncated trees and inconsistent blob bytes", async () => {
  const { bundle, fetcher } = github();
  await expect(
    fetchAssertionBundle(bundle.repository, "main", bundle.manifestPath, "token", fetcher),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  for (const invalid of [github("100644", true), github("100644", false, true)])
    await expect(
      fetchAssertionBundle(
        bundle.repository,
        bundle.commit,
        bundle.manifestPath,
        "token",
        invalid.fetcher,
      ),
    ).rejects.toThrow();
});
