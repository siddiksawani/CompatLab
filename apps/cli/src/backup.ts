import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { link, open, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("CLB1"),
  maximum = 64 * 1024 ** 3;
async function backupKey(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      ![0, process.getuid?.()].includes(info.uid) ||
      (info.mode & 0o077) !== 0 ||
      info.size > 65
    )
      throw new TypeError(
        "Backup key must be an owned private regular file containing 64 hex characters.",
      );
    const value = (await file.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError("Invalid backup key.");
    return Buffer.from(value, "hex");
  } finally {
    await file.close();
  }
}
async function publish(path: string, temporary: string) {
  const file = await open(temporary, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  await link(temporary, path);
}
export async function encryptBackup(input: string, output: string, keyPath: string) {
  const key = await backupKey(keyPath),
    iv = randomBytes(12),
    header = Buffer.concat([magic, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  let started = false,
    size = 0;
  const encoder = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      try {
        size += chunk.length;
        if (size > maximum) throw new TypeError("Backup exceeds 64 GiB.");
        if (!started) {
          this.push(header);
          started = true;
        }
        this.push(cipher.update(chunk));
        done();
      } catch (error) {
        done(error as Error);
      }
    },
    flush(done) {
      try {
        if (!started) this.push(header);
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        done();
      } catch (error) {
        done(error as Error);
      }
    },
  });
  const temporary = `${output}.partial-${randomUUID()}`;
  try {
    await pipeline(
      createReadStream(input),
      encoder,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    await publish(output, temporary);
  } finally {
    key.fill(0);
    await rm(temporary, { force: true });
  }
}
export async function decryptBackup(input: string, output: string, keyPath: string) {
  const key = await backupKey(keyPath),
    source = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW);
  const temporary = `${output}.partial-${randomUUID()}`;
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size < 32 || info.size > maximum + 32)
      throw new TypeError("Invalid encrypted backup size.");
    const header = Buffer.alloc(16),
      tag = Buffer.alloc(16);
    await source.read(header, 0, 16, 0);
    await source.read(tag, 0, 16, info.size - 16);
    if (!header.subarray(0, 4).equals(magic)) throw new TypeError("Unknown backup format.");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(4));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(
      info.size === 32
        ? Readable.from([])
        : source.createReadStream({ start: 16, end: info.size - 17, autoClose: false }),
      decipher,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    await publish(output, temporary);
  } finally {
    key.fill(0);
    await source.close();
    await rm(temporary, { force: true });
  }
}
export async function runBackup(
  args: readonly string[],
  io: { stdout(text: string): void; stderr(text: string): void },
) {
  if (args.length !== 4 || !["encrypt", "decrypt"].includes(args[0] ?? "")) {
    io.stderr("Usage: compatlab backup encrypt|decrypt INPUT OUTPUT KEY_FILE\n");
    return 2;
  }
  try {
    const operation = args[0] === "encrypt" ? encryptBackup : decryptBackup;
    await operation(args[1] ?? "", args[2] ?? "", args[3] ?? "");
    io.stdout('{"ok":true}\n');
    return 0;
  } catch {
    io.stderr("Backup operation failed; no completed output was published.\n");
    return 3;
  }
}
