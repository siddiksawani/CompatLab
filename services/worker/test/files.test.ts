import { execFileSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectTree, readBoundedFile } from "../src/preparation/files.js";

let base: string;
let root: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "compatlab-tree-"));
  root = join(base, "workspace");
  await mkdir(root);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("stopped workspace validation", () => {
  it("accepts internal links and hashes bytes and executable mode deterministically", async () => {
    await mkdir(join(root, "lib"));
    await writeFile(join(root, "lib", "index.js"), "export default 1;");
    await symlink("lib/index.js", join(root, "entry"));
    await link(join(root, "lib", "index.js"), join(root, "copy.js"));
    const first = await inspectTree(root);
    expect((await inspectTree(root)).digest).toBe(first.digest);
    await chmod(join(root, "lib", "index.js"), 0o755);
    expect((await inspectTree(root)).digest).not.toBe(first.digest);
    await writeFile(join(root, "copy.js"), "export default 2;");
    expect((await inspectTree(root)).digest).not.toBe(first.digest);
    expect(first.entries.find((entry) => entry.path === "entry")?.target).toBe("lib/index.js");
  });

  it.each(["../outside", "/etc/passwd", "missing", "escape"])(
    "rejects an unsafe symlink: %s",
    async (target) => {
      await writeFile(join(base, "outside"), "private");
      await symlink(target, join(root, "escape"));
      await expect(inspectTree(root)).rejects.toMatchObject({ classification: "archive_rejected" });
    },
  );

  it("rejects a symlink chain and a hard link outside the snapshot", async () => {
    await writeFile(join(base, "outside"), "private");
    await link(join(base, "outside"), join(root, "linked"));
    await expect(inspectTree(root)).rejects.toMatchObject({ classification: "archive_rejected" });
    await rm(join(root, "linked"));
    await symlink("../outside", join(root, "a"));
    await symlink("a", join(root, "b"));
    await expect(inspectTree(root)).rejects.toMatchObject({ classification: "archive_rejected" });
  });

  it("rejects special files without opening them", async () => {
    execFileSync("mkfifo", [join(root, "pipe")]);
    await expect(inspectTree(root)).rejects.toMatchObject({ classification: "archive_rejected" });
    await expect(readBoundedFile(join(root, "pipe"), 100)).rejects.toThrow();
  });

  it("enforces total file/byte limits and cancellation", async () => {
    await writeFile(join(root, "a"), "1234");
    await writeFile(join(root, "b"), "1234");
    await expect(inspectTree(root, { files: 1, bytes: 100 })).rejects.toMatchObject({
      classification: "preparation_limit_exceeded",
    });
    await expect(inspectTree(root, { files: 10, bytes: 7 })).rejects.toMatchObject({
      classification: "preparation_limit_exceeded",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(inspectTree(root, undefined, controller.signal)).rejects.toThrow();
  });

  it("rejects oversized and symlinked protocol files", async () => {
    await writeFile(join(root, "large"), "a".repeat(100));
    await expect(readBoundedFile(join(root, "large"), 99)).rejects.toThrow();
    expect((await readBoundedFile(join(root, "large"), 100)).length).toBe(100);
    await symlink("large", join(root, "alias"));
    await expect(readBoundedFile(join(root, "alias"), 100)).rejects.toThrow();
  });
});
