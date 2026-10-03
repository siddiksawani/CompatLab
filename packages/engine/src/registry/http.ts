import { setTimeout as delay } from "node:timers/promises";
import { RegistryError } from "./errors.js";
import { JsonStructureLimit } from "./json-limits.js";
import { REGISTRY_ORIGIN } from "./validation.js";

export type RegistryHttpOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
};

export class RegistryHttp {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(options: RegistryHttpOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30_000 ||
      !Number.isInteger(this.attempts) ||
      this.attempts < 1 ||
      this.attempts > 3 ||
      !Number.isInteger(this.retryDelayMs) ||
      this.retryDelayMs < 0 ||
      this.retryDelayMs > 2_000
    )
      throw new TypeError("Registry HTTP limits are outside the supported range.");
  }

  async json(
    url: URL,
    options: {
      maxBytes: number;
      accept: string;
      notFound: "package_not_found" | "package_version_not_found";
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    if (
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 1 ||
      options.maxBytes > 32 * 1024 * 1024
    ) {
      throw new TypeError("Metadata limits must be between 1 byte and 32 MiB.");
    }
    if (url.origin !== REGISTRY_ORIGIN || url.username || url.password || url.hash) {
      throw new TypeError("Registry requests must use the public npm origin.");
    }
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      let response: Response | undefined;
      try {
        signal.throwIfAborted();
        response = await this.fetch(url, {
          headers: { Accept: options.accept },
          credentials: "omit",
          redirect: "manual",
          signal,
        });
        if (response.status === 404) {
          throw new RegistryError(
            options.notFound,
            "The requested package or version is unavailable.",
          );
        }
        if (!response.ok) {
          throw new RegistryError(
            "registry_unavailable",
            "The registry did not return usable metadata.",
            response.status === 429 || response.status >= 500,
          );
        }
        return await readJson(response, options.maxBytes);
      } catch (error) {
        if (options.signal?.aborted)
          throw new DOMException("Registry request cancelled.", "AbortError");
        const failure =
          error instanceof RegistryError
            ? error
            : new RegistryError(
                "registry_unavailable",
                "The registry request could not complete.",
                true,
              );
        if (!failure.retryable || attempt + 1 === this.attempts || signal.aborted) throw failure;
        const retryAfter = Number(response?.headers.get("retry-after"));
        const pause =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(2_000, retryAfter * 1_000)
            : this.retryDelayMs * 2 ** attempt;
        await response?.body?.cancel().catch(() => {});
        response = undefined;
        try {
          await delay(pause, undefined, { signal });
        } catch {
          if (options.signal?.aborted)
            throw new DOMException("Registry request cancelled.", "AbortError");
          throw new RegistryError(
            "registry_unavailable",
            "The registry request deadline expired.",
            true,
          );
        }
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    }
    throw new RegistryError("registry_unavailable", "Registry attempts exhausted.", true);
  }
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!contentType || !/^application\/(?:json|[a-z0-9.-]+\+json)$/.test(contentType)) {
    throw new RegistryError("package_manifest_invalid", "The registry response is not JSON.");
  }
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (
    (!encoding || encoding === "identity") &&
    Number(response.headers.get("content-length")) > maxBytes
  ) {
    throw new RegistryError(
      "preparation_limit_exceeded",
      "Registry metadata exceeds its byte limit.",
    );
  }
  if (!response.body)
    throw new RegistryError("package_manifest_invalid", "The registry response is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const structure = new JsonStructureLimit();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new RegistryError(
          "preparation_limit_exceeded",
          "Registry metadata exceeds its byte limit.",
        );
      structure.write(value);
      chunks.push(value);
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
      );
    } catch {
      throw new RegistryError(
        "package_manifest_invalid",
        "The registry returned invalid UTF-8 JSON.",
      );
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
