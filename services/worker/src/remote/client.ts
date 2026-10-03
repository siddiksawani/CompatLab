import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { parseBoundedJson } from "@compatlab/contracts";

export class ControlError extends Error {
  override readonly name = "ControlError";
  constructor(readonly status: number) {
    super(`Private control request failed (${status}).`);
  }
}
export class ControlClient {
  private readonly url: URL;
  constructor(
    address: string,
    private readonly token: string,
  ) {
    this.url = new URL(address);
    const host = this.url.hostname;
    if (
      !["http:", "https:"].includes(this.url.protocol) ||
      isIP(host) !== 4 ||
      !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      this.url.username ||
      this.url.password ||
      this.url.pathname !== "/" ||
      this.url.search ||
      this.url.hash ||
      !/^clw_[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new TypeError("Use a private IPv4 control origin and a valid worker token.");
  }
  async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (
      !/^\/v1\/(?:workers\/(?:ready|evictions)|jobs\/(?:claim|renew|results|abandon))$/.test(path)
    )
      throw new TypeError("Unknown private endpoint.");
    const bytes = Buffer.from(JSON.stringify(body));
    if (bytes.length > 32 * 1024 ** 2) throw new TypeError("Worker request exceeds 32 MiB.");
    const combined = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    return new Promise((resolve, reject) => {
      const send = this.url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = send(
        new URL(path, this.url),
        {
          method: "POST",
          agent: false,
          signal: combined,
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            "content-length": bytes.length,
          },
        },
        async (response) => {
          try {
            if (response.statusCode !== 200) {
              response.destroy();
              throw new ControlError(response.statusCode ?? 500);
            }
            const chunks: Buffer[] = [];
            let length = 0;
            for await (const chunk of response) {
              const bytes = Buffer.from(chunk);
              length += bytes.length;
              if (length > 16 * 1024 ** 2) {
                response.destroy();
                throw new TypeError("Control response exceeds 16 MiB.");
              }
              chunks.push(bytes);
            }
            resolve(parseBoundedJson(Buffer.concat(chunks, length), 16 * 1024 ** 2));
          } catch (error) {
            reject(error);
          }
        },
      );
      request.on("error", reject);
      request.end(bytes);
    });
  }
}
