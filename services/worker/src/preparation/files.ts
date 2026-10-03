import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PreparationError } from "@compatlab/engine";

export async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ELOOP") reject("A protocol file must not be a symlink.");
    throw error;
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new PreparationError("preparation_limit_exceeded", "Expected a bounded regular file.");
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, stat.size + 1));
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes || size > stat.size)
      throw new PreparationError("preparation_limit_exceeded", "The file grew while being read.");
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}

export type TreeEntry = {
  path: string;
  kind: "directory" | "file" | "symlink";
  bytes: number;
  executable: boolean;
  target?: string;
};
export type TreeInspection = { bytes: number; entries: TreeEntry[]; digest: string };

export async function inspectTree(
  root: string,
  limits = { bytes: 512 * 1024 * 1024, files: 50_000 },
  signal?: AbortSignal,
): Promise<TreeInspection> {
  const actualRoot = await realpath(root);
  if (!(await lstat(root)).isDirectory()) reject("The workspace must be a real directory.");
  const queue = [""];
  const entries: TreeEntry[] = [];
  const inodes = new Map<string, { expected: number; observed: number }>();
  const hash = createHash("sha256");
  let bytes = 0;
  while (queue.length) {
    signal?.throwIfAborted();
    const directory = queue.pop();
    if (directory === undefined) break;
    const names = (await readdir(join(actualRoot, directory))).sort();
    if (entries.length + names.length > limits.files) limit();
    for (const name of names) {
      signal?.throwIfAborted();
      const path = directory ? `${directory}/${name}` : name;
      if (path.length > 4096 || path.split("/").length > 64)
        reject("Workspace paths exceed the supported depth.");
      const absolute = join(actualRoot, path);
      const stat = await lstat(absolute);
      let entry: TreeEntry;
      if (stat.isDirectory()) {
        entry = { path, kind: "directory", bytes: 0, executable: true };
        queue.push(path);
      } else if (stat.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (isAbsolute(target) || !inside(actualRoot, resolve(dirname(absolute), target)))
          reject("A symlink escapes the workspace.");
        const resolved = await realpath(absolute).catch(() =>
          reject("A symlink is dangling or cyclic."),
        );
        if (!inside(actualRoot, resolved)) reject("A symlink resolves outside the workspace.");
        entry = {
          path,
          kind: "symlink",
          bytes: Buffer.byteLength(target),
          executable: false,
          target,
        };
      } else if (stat.isFile()) {
        entry = { path, kind: "file", bytes: stat.size, executable: (stat.mode & 0o111) !== 0 };
        const key = `${stat.dev}:${stat.ino}`;
        const inode = inodes.get(key) ?? { expected: stat.nlink, observed: 0 };
        inode.observed++;
        inodes.set(key, inode);
      } else reject("Special files are not allowed in a workspace.");
      bytes += entry.bytes;
      if (bytes > limits.bytes || entries.length >= limits.files) limit();
      entries.push(entry);
      hash.update(JSON.stringify(entry)).update("\n");
      if (entry.kind === "file") {
        const file = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const opened = await file.stat();
          if (
            !opened.isFile() ||
            opened.ino !== stat.ino ||
            opened.dev !== stat.dev ||
            opened.size !== stat.size
          )
            reject("The stopped workspace changed during inspection.");
          const chunk = Buffer.alloc(64 * 1024);
          let read = 0;
          while (read < stat.size) {
            signal?.throwIfAborted();
            const { bytesRead } = await file.read(
              chunk,
              0,
              Math.min(chunk.length, stat.size - read),
              null,
            );
            if (!bytesRead) reject("The stopped workspace changed during inspection.");
            hash.update(chunk.subarray(0, bytesRead));
            read += bytesRead;
          }
        } finally {
          await file.close();
        }
        hash.update("\n");
      }
    }
  }
  if ([...inodes.values()].some((inode) => inode.expected !== inode.observed))
    reject("A hard link points outside the workspace.");
  return { bytes, entries, digest: hash.digest("hex") };
}

function inside(root: string, path: string): boolean {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}
function reject(message: string): never {
  throw new PreparationError("archive_rejected", message);
}
function limit(): never {
  throw new PreparationError(
    "preparation_limit_exceeded",
    "The installed tree exceeds its file or byte limit.",
  );
}
