import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, rm, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { encryptBackup } from "../apps/cli/dist/backup.js";

const directory = resolve(process.env.BACKUP_DIRECTORY ?? "/var/lib/compatlab-backups");
const key = process.env.BACKUP_KEY_FILE,
  container = process.env.BACKUP_POSTGRES_CONTAINER,
  target = process.env.BACKUP_SSH_TARGET;
const match = /^([a-zA-Z0-9_][a-zA-Z0-9_.@-]*):(\/[a-zA-Z0-9_./-]+)$/.exec(target ?? "");
if (
  !key ||
  !container ||
  !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container) ||
  !match ||
  match[2].split("/").includes("..")
)
  throw new Error(
    "Set BACKUP_KEY_FILE, BACKUP_POSTGRES_CONTAINER and BACKUP_SSH_TARGET=user@host:/absolute/directory.",
  );
await mkdir(directory, { recursive: true, mode: 0o700 });
const info = await lstat(directory);
if (!info.isDirectory() || (info.mode & 0o077) !== 0 || ![0, process.getuid?.()].includes(info.uid))
  throw new Error("Use a private owned backup directory.");
const temporary = await mkdtemp(join(directory, "dump-"));
const file = `compatlab-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.clb`;
const destination = join(directory, file),
  execute = promisify(execFile);
const sshOptions = ["-oBatchMode=yes", "-oStrictHostKeyChecking=yes", "-oConnectTimeout=10"];
const [, remoteHost, remotePath] = match;
let completed = false;
async function localRetention() {
  for (const name of await readdir(directory)) {
    if (!/^compatlab-[0-9TZ:.-]+-[a-f0-9-]+\.clb$/.test(name)) continue;
    const path = join(directory, name),
      entry = await lstat(path);
    if (entry.isFile() && entry.mtimeMs < Date.now() - 7 * 86400_000) await rm(path);
  }
}
try {
  await localRetention();
  const dump = join(temporary, "database.dump");
  const disk = await statfs(directory);
  const maximumDump = Math.min(
    64 * 1024 ** 3,
    Math.floor((disk.bavail * disk.bsize - 1024 ** 3) / 2),
  );
  if (maximumDump < 1024 ** 2) throw new Error("Insufficient backup storage headroom.");
  let dumped = 0;
  const bounded = new Transform({
    transform(chunk, _encoding, done) {
      dumped += chunk.length;
      done(
        dumped > maximumDump ? new Error("Database dump exceeds available backup storage.") : null,
        chunk,
      );
    },
  });
  const child = spawn(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "--username=postgres",
      "--dbname=compatlab",
      "--format=custom",
      "--no-owner",
      "--no-acl",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 3_600_000 },
  );
  const complete = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Database dump failed.")),
    );
  });
  child.stderr.resume();
  try {
    await Promise.all([
      complete,
      pipeline(child.stdout, bounded, createWriteStream(dump, { flags: "wx", mode: 0o600 })),
    ]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await complete.catch(() => {});
    }
  }
  await encryptBackup(dump, destination, key);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(destination)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const digest = hash.digest("hex"),
    [, _host, _path] = match;
  await execute("ssh", [...sshOptions, _host, `mkdir -p -m 700 -- '${_path}'`], {
    timeout: 15_000,
  });
  await execute(
    "ssh",
    [
      ...sshOptions,
      _host,
      `find '${_path}' -maxdepth 1 -type f \\( -name 'compatlab-*.clb' -o -name 'compatlab-*.clb.partial' \\) -mtime +6 -delete`,
    ],
    { timeout: 15_000 },
  );
  await execute("scp", [...sshOptions, destination, `${_host}:${_path}/${file}.partial`], {
    timeout: 3_600_000,
  });
  const verified = await execute(
    "ssh",
    [...sshOptions, _host, `sha256sum -- '${_path}/${file}.partial'`],
    { timeout: 15_000 },
  );
  if (verified.stdout.split(/\s/)[0] !== digest)
    throw new Error("Off-host archive digest mismatch.");
  await execute(
    "ssh",
    [
      ...sshOptions,
      _host,
      `mv -- '${_path}/${file}.partial' '${_path}/${file}' && sync -f '${_path}'`,
    ],
    { timeout: 15_000 },
  );
  await execute(
    process.execPath,
    [
      "apps/cli/dist/bin.js",
      "admin",
      "backup-record",
      digest,
      String(bytes),
      "--reason",
      "Encrypted database backup verified off-host.",
    ],
    { timeout: 15_000 },
  );

  completed = true;
  process.stdout.write(`${JSON.stringify({ file, digest, bytes, uploaded: true })}\n`);
} finally {
  if (!completed) await rm(destination, { force: true });
  await execute("ssh", [...sshOptions, remoteHost, `rm -f -- '${remotePath}/${file}.partial'`], {
    timeout: 15_000,
  }).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
