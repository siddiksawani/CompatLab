import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const sums = {
  amd64: "727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b",
  arm64: "d8fc6d179a5d283028a472a5618564f6ad8a86fed513e64f032b3b0b7cc45e42",
};
const arch = process.env.TARGETARCH;
if (!Object.hasOwn(sums, arch ?? "")) throw new Error("Unsupported proxy architecture.");
const response = await fetch(
  `https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_${arch}.tar.gz`,
  { signal: AbortSignal.timeout(60_000) },
);
if (!response.ok) throw new Error("Caddy release unavailable.");
const chunks = [];
let total = 0;
for await (const chunk of response.body) {
  total += chunk.length;
  if (total > 64 * 1024 * 1024) throw new Error("Release exceeds its size limit.");
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
if (createHash("sha256").update(bytes).digest("hex") !== sums[arch])
  throw new Error("Caddy release digest mismatch.");
await writeFile("/tmp/caddy.tar.gz", bytes, { flag: "wx" });
