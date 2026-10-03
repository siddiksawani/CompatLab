import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

export const publicConfigSchema = z
  .strictObject({
    origin: z.url(),
    matrixId: z.uuid(),
    scansEnabled: z.boolean(),
    requesterSecret: z.string().regex(/^[a-f0-9]{64}$/),
    proxySecret: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine((config) => {
    const url = new URL(config.origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.origin === config.origin &&
      (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      (local || !!config.proxySecret)
    );
  }, "Use an HTTPS origin and authenticated reverse proxy outside loopback development.");
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export class PublicRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export function requesterKey(request: Request, config: PublicConfig, now = new Date()) {
  let address = "loopback-development";
  if (config.proxySecret) {
    const provided = Buffer.from(request.headers.get("x-compatlab-proxy-token") ?? "");
    const expected = Buffer.from(config.proxySecret);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      throw new PublicRequestError(403, "untrusted_proxy");
    address = request.headers.get("x-compatlab-client-ip") ?? "";
    const family = isIP(address);
    if (!family) throw new PublicRequestError(400, "invalid_client_address");
    if (family === 6) {
      const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
      const [left = "", right = ""] = canonical.split("::");
      const start = left ? left.split(":") : [],
        end = right ? right.split(":") : [];
      const expanded = canonical.includes("::")
        ? [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end]
        : start;
      const words = expanded.map((part) => Number.parseInt(part, 16));
      if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
        const high = words[6] ?? 0,
          low = words[7] ?? 0;
        address = [high >> 8, high & 255, low >> 8, low & 255].join(".");
      } else {
        address = expanded
          .slice(0, 4)
          .map((part) => part.padStart(4, "0"))
          .join(":");
      }
    }
  }
  return createHmac("sha256", config.requesterSecret)
    .update(`${now.toISOString().slice(0, 10)}:${address}`)
    .digest("hex");
}
export async function readAdmissionBody(request: Request, origin: string): Promise<unknown> {
  if (
    request.headers.get("origin") !== origin ||
    (request.headers.get("sec-fetch-site") &&
      !["same-origin", "none"].includes(request.headers.get("sec-fetch-site") ?? ""))
  )
    throw new PublicRequestError(403, "origin_rejected");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    throw new PublicRequestError(415, "json_required");
  if (Number(request.headers.get("content-length")) > 2048)
    throw new PublicRequestError(413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new PublicRequestError(400, "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const signal = AbortSignal.timeout(5000);
  const expired = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", expired, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new PublicRequestError(408, "body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > 2048) throw new PublicRequestError(413, "body_too_large");
      chunks.push(value);
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
      );
    } catch {
      throw new PublicRequestError(400, "invalid_request");
    }
  } finally {
    signal.removeEventListener("abort", expired);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
