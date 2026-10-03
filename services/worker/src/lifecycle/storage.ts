import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function privateDirectory(path: string): Promise<string> {
  const directory = resolve(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let current = directory;
  while (true) {
    const info = await lstat(current);
    const stickyParent = current !== directory && (info.mode & 0o1000) !== 0;
    if (
      !info.isDirectory() ||
      info.uid !== 0 ||
      ((info.mode & 0o022) !== 0 && !stickyParent) ||
      (current === directory && (info.mode & 0o077) !== 0)
    )
      throw new TypeError(
        "Worker storage requires private root-owned directories and trusted parents.",
      );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directory;
}
