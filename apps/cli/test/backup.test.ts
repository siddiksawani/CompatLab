import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decryptBackup, encryptBackup } from "../src/backup.js";

it("authenticates streaming backups before publishing restored bytes and never overwrites output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compatlab-backup-"));
  try {
    const source = join(directory, "dump"),
      key = join(directory, "key"),
      encrypted = join(directory, "encrypted"),
      restored = join(directory, "restored");
    const bytes = randomBytes(2 * 1024 * 1024 + 51);
    await writeFile(source, bytes);
    await writeFile(key, randomBytes(32).toString("hex"), { mode: 0o600 });
    await encryptBackup(source, encrypted, key);
    await decryptBackup(encrypted, restored, key);
    expect(await readFile(restored)).toEqual(bytes);
    await expect(encryptBackup(source, encrypted, key)).rejects.toMatchObject({ code: "EEXIST" });
    const damaged = await readFile(encrypted);
    damaged[30] = (damaged[30] ?? 0) ^ 1;
    await writeFile(encrypted, damaged);
    await expect(decryptBackup(encrypted, join(directory, "tampered"), key)).rejects.toThrow();
    expect(await readdir(directory)).not.toContain("tampered");
    expect((await readdir(directory)).some((name) => name.includes("partial"))).toBe(false);
    await chmod(key, 0o644);
    await expect(encryptBackup(source, join(directory, "insecure"), key)).rejects.toThrow(
      "private",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
