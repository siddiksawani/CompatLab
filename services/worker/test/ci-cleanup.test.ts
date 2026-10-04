import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireHostLease } from "../src/lifecycle/lease.js";
import { checkCiPackage } from "../src/local.js";
import { buildRuntimeImages } from "../src/runtime/images.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    lstat: vi.fn(async (...args: Parameters<typeof fs.lstat>) =>
      Object.assign(await fs.lstat(...args), { uid: 0 }),
    ),
  };
});
vi.mock("../src/preparation/prepare.js", async (original) => ({
  ...(await original<typeof import("../src/preparation/prepare.js")>()),
  assertPreparationHost: vi.fn(),
}));
vi.mock("../src/lifecycle/lease.js", () => ({ acquireHostLease: vi.fn() }));
vi.mock("../src/lifecycle/recovery.js", () => ({
  recoverResources: vi.fn(async (state: string) => {
    await mkdir(join(state, "jobs"), { recursive: true, mode: 0o700 });
  }),
  collectSnapshots: vi.fn(),
}));
vi.mock("../src/lifecycle/storage.js", () => ({
  privateDirectory: vi.fn(async (path: string) => path),
}));
vi.mock("../src/runtime/images.js", () => ({
  buildRuntimeImages: vi.fn(),
  verifyRuntimeImages: vi.fn(),
}));

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "compatlab-ci-cleanup-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
it.each([false, true])(
  "removes the staged archive after failure, including failed shutdown: %s",
  async (shutdownFails) => {
    const state = join(base, "state"),
      artifactFile = join(base, "artifact.tgz"),
      provenanceFile = join(base, "provenance.json");
    await writeFile(artifactFile, "unexecuted fixture");
    await writeFile(
      provenanceFile,
      JSON.stringify({
        provider: "github_actions",
        confidence: "caller_supplied",
        repository: "owner/package",
        commit: "a".repeat(40),
        workflow: ".github/workflows/ci.yml",
        runId: "1",
        runAttempt: 1,
      }),
    );
    const close = vi.fn(async () => {
      if (shutdownFails) throw new Error("lease close failed");
    });
    vi.mocked(acquireHostLease).mockResolvedValue({
      previousState: null,
      lost: new AbortController().signal,
      activate: vi.fn(async () => {}),
      close,
    });
    vi.mocked(buildRuntimeImages).mockImplementation(async () => {
      const staged = await readdir(join(state, "jobs"));
      expect(staged).toHaveLength(1);
      expect(await readFile(join(state, "jobs", staged[0] ?? "", "artifact.tgz"), "utf8")).toBe(
        "unexecuted fixture",
      );
      throw new Error("image build failed");
    });
    await expect(
      checkCiPackage("fixture@1.0.0", { stateDirectory: state, artifactFile, provenanceFile }),
    ).rejects.toThrow(shutdownFails ? "lease close failed" : "image build failed");
    expect(close).toHaveBeenCalledOnce();
    expect(await readdir(join(state, "jobs"))).toEqual([]);
  },
);
