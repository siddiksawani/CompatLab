import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [domain, directory, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  !domain ||
  !/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
  !directory
)
  throw new Error("Usage: node infra/configure.mjs DOMAIN NEW_PRIVATE_DIRECTORY");
const path = resolve(directory);
if (!relative(fileURLToPath(new URL("../", import.meta.url)), path).startsWith(".."))
  throw new Error("Keep private configuration outside the checkout.");
await mkdir(path, { mode: 0o700 });
const secret = () => randomBytes(32).toString("hex");
const postgres = secret(),
  web = secret(),
  control = secret(),
  operator = secret(),
  proxy = secret();
const files = {
  "postgres.env": `POSTGRES_DB=compatlab\nPOSTGRES_PASSWORD=${postgres}\nWEB_DB_PASSWORD=${web}\nCONTROL_DB_PASSWORD=${control}\nOPERATOR_DB_PASSWORD=${operator}\n`,
  "web.env": `DATABASE_URL=postgres://compatlab_web:${web}@postgres:5432/compatlab\nPUBLIC_ORIGIN=https://${domain}\nPUBLIC_MATRIX_ID=00000000-0000-0000-0000-000000000000\nREQUESTER_SECRET=${secret()}\nPROXY_SECRET=${proxy}\nPUBLIC_SCANS_ENABLED=false\nNEXT_TELEMETRY_DISABLED=1\n`,
  "control.env": `DATABASE_URL=postgres://compatlab_control:${control}@127.0.0.1:55432/compatlab\nCONTROL_BIND_ADDRESS=10.44.0.1\nCONTROL_WIREGUARD_INTERFACE=wg0\nCONTROL_PORT=4871\n`,
  "proxy.env": `PUBLIC_DOMAIN=${domain}\nPROXY_SECRET=${proxy}\n`,
  "operator-url": `postgres://compatlab_operator:${operator}@127.0.0.1:55432/compatlab\n`,
  "migration-url": `postgres://postgres:${postgres}@127.0.0.1:55432/compatlab\n`,
  "backup-key": `${secret()}\n`,
};
for (const [name, value] of Object.entries(files))
  await writeFile(join(path, name), value, { flag: "wx", mode: 0o600 });
process.stdout.write(
  `Created private configuration in ${path}. Set the matrix ID and WireGuard address before starting services.\n`,
);
