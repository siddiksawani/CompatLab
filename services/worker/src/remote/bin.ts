import { lstat } from "node:fs/promises";
import { readBoundedFile } from "../preparation/files.js";
import { runWorker } from "./agent.js";

const path = process.env.WORKER_TOKEN_FILE;
const controlUrl = process.env.CONTROL_URL;
if (!path || !controlUrl) throw new Error("CONTROL_URL and WORKER_TOKEN_FILE are required.");
const info = await lstat(path);
if (!info.isFile() || info.uid !== 0 || (info.mode & 0o077) !== 0)
  throw new Error("The worker token file must be private and root-owned.");
const token = (await readBoundedFile(path, 128)).toString("utf8").trim();
const cancellation = new AbortController();
process.once("SIGTERM", () => cancellation.abort());
process.once("SIGINT", () => cancellation.abort());
await runWorker({
  controlUrl,
  token,
  stateDirectory: process.env.WORKER_STATE_DIRECTORY ?? "/var/lib/compatlab",
  signal: cancellation.signal,
});
