import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { openCatalog, reconcileCatalog } from "@compatlab/catalog";
import { createControlServer } from "./server.js";

const address = process.env.CONTROL_BIND_ADDRESS;
const device = process.env.CONTROL_WIREGUARD_INTERFACE ?? "wg0";
if (
  !address ||
  !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ||
  !/^[a-zA-Z0-9_-]{1,15}$/.test(device)
)
  throw new Error("Set CONTROL_BIND_ADDRESS to this host's private WireGuard IPv4 address.");
const links = JSON.parse(
  (
    await promisify(execFile)("ip", ["-details", "-json", "link", "show", "dev", device], {
      timeout: 5000,
      maxBuffer: 16_384,
    })
  ).stdout,
) as { linkinfo?: { info_kind?: string } }[];
if (
  links[0]?.linkinfo?.info_kind !== "wireguard" ||
  !networkInterfaces()[device]?.some((entry) => entry.address === address)
)
  throw new Error("The private API must bind to a configured WireGuard interface.");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the control process.");
const port = Number(process.env.CONTROL_PORT ?? 4871);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid control port.");
const catalog = openCatalog(databaseUrl);
const server = createControlServer(catalog.db);
let stopping = false;
let timer: NodeJS.Timeout | undefined;
let maintenance: Promise<void> = Promise.resolve();
function schedule() {
  timer = setTimeout(() => {
    maintenance = reconcileCatalog(catalog.db)
      .then(() => undefined)
      .catch(() => {
        process.stderr.write('{"level":"error","event":"reconciliation_failed"}\n');
      })
      .finally(() => {
        if (!stopping) schedule();
      });
  }, 5000);
}
await reconcileCatalog(catalog.db);
server.listen(port, address);
schedule();
async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await maintenance;
  await catalog.close();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
