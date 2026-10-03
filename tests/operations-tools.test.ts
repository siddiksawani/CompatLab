import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
it("rejects malformed DNS and symlinked checkout destinations before creating secrets", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "compatlab-config-test-"));
  const inside = resolve(`.qualification-secrets-${randomUUID()}`);
  try {
    const destination = join(temporary, "config");
    for (const domain of ["a..example", "a-.example", "-a.example", `${"a".repeat(64)}.example`])
      await expect(
        execute(process.execPath, ["infra/configure.mjs", domain, destination]),
      ).rejects.toThrow();
    expect(await readdir(temporary)).toEqual([]);
    await symlink(process.cwd(), join(temporary, "checkout"));
    await expect(
      execute(process.execPath, [
        "infra/configure.mjs",
        "valid.example",
        join(temporary, "checkout", inside.split("/").at(-1) ?? ""),
      ]),
    ).rejects.toThrow("outside the checkout");
    await expect(lstat(inside)).rejects.toMatchObject({ code: "ENOENT" });
    await execute(process.execPath, ["infra/configure.mjs", "valid.example", destination]);
    const original = await readFile(join(destination, "backup-key"));
    expect((await lstat(destination)).mode & 0o077).toBe(0);
    await expect(
      execute(process.execPath, ["infra/configure.mjs", "valid.example", destination]),
    ).rejects.toThrow();
    expect(await readFile(join(destination, "backup-key"))).toEqual(original);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
it("removes failed encrypted uploads and expired local archives during a transport outage", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "compatlab-backup-failure-"));
  try {
    const bins = join(temporary, "bin"),
      archives = join(temporary, "archives"),
      key = join(temporary, "key"),
      calls = join(temporary, "ssh-calls");
    await mkdir(bins);
    await mkdir(archives, { mode: 0o700 });
    await writeFile(key, "a".repeat(64), { mode: 0o600 });
    await writeFile(join(bins, "docker"), '#!/bin/sh\nprintf "fixture dump"\n', { mode: 0o700 });
    await writeFile(
      join(bins, "ssh"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$QUALIFICATION_SSH_CALLS"\nexit 1\n',
      { mode: 0o700 },
    );
    const old = join(archives, `compatlab-2026-01-01T00-00-00.000Z-${randomUUID()}.clb`);
    await writeFile(old, "old archive");
    await utimes(old, new Date(0), new Date(0));
    await expect(
      execute(process.execPath, ["infra/backup.mjs"], {
        env: {
          ...process.env,
          PATH: `${bins}:${process.env.PATH}`,
          QUALIFICATION_SSH_CALLS: calls,
          BACKUP_DIRECTORY: archives,
          BACKUP_KEY_FILE: key,
          BACKUP_POSTGRES_CONTAINER: "fixture",
          BACKUP_SSH_TARGET: "fixture:/private/backups",
        },
      }),
    ).rejects.toThrow();
    expect(await readdir(archives)).toEqual([]);
    expect(await readFile(calls, "utf8")).toContain("rm -f -- '/private/backups/compatlab-");
    expect(await readFile(calls, "utf8")).toContain(".clb.partial'");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
