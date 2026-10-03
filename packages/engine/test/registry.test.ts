import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RegistryClient } from "../src/registry/client.js";
import { RegistryHttp } from "../src/registry/http.js";
import {
  JsonStructureLimit,
  MAX_JSON_DEPTH,
  MAX_JSON_STRING_BYTES,
} from "../src/registry/json-limits.js";
import {
  artifactIntegrity,
  assertPackageName,
  assertSelector,
  registryTarballUrl,
} from "../src/registry/validation.js";

const integrity = `sha512-${createHash("sha512").update("fixture").digest("base64")}`;
const manifest = (name: string, version: string) => ({
  name,
  version,
  dist: { tarball: `https://registry.npmjs.org/${name}/-/fixture-${version}.tgz`, integrity },
});

function fixtureClient(handler: (url: URL, init?: RequestInit) => unknown) {
  const requests: URL[] = [];
  const client = new RegistryClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      return Response.json(handler(url, init));
    },
    retryDelayMs: 0,
  });
  return { client, requests };
}

describe("exact registry identity", () => {
  it("encodes scoped names and observes moving tags without mutating an earlier artifact", async () => {
    let latest = "1.0.0";
    const { client, requests } = fixtureClient((url) =>
      url.pathname.endsWith("lab")
        ? {
            name: "@scope/lab",
            versions: { "1.0.0": {}, "2.0.0": {}, bad: {} },
            "dist-tags": { latest },
          }
        : manifest("@scope/lab", decodeURIComponent(url.pathname.split("/").at(-1) ?? "")),
    );
    const first = await client.resolve("@scope/lab");
    latest = "2.0.0";
    const second = await client.resolve("@scope/lab");
    expect(first.version).toBe("1.0.0");
    expect(first.observedTags.latest).toBe("1.0.0");
    expect(second.version).toBe("2.0.0");
    expect(requests.map((url) => url.pathname)).toEqual([
      "/%40scope%2Flab",
      "/%40scope%2Flab/1.0.0",
      "/%40scope%2Flab",
      "/%40scope%2Flab/2.0.0",
    ]);
  });

  it("lists and resolves numeric-leading tags using npm tag semantics", async () => {
    const { client } = fixtureClient((url) =>
      url.pathname === "/lab"
        ? {
            name: "lab",
            versions: { "1.0.0": {} },
            "dist-tags": { "0.14-stable": "1.0.0", "1.x": "1.0.0", "\ud800": "1.0.0" },
          }
        : manifest("lab", "1.0.0"),
    );
    expect((await client.versions("lab")).tags).toEqual({ "0.14-stable": "1.0.0" });
    expect((await client.resolve("lab", "0.14-stable")).version).toBe("1.0.0");
    await expect(client.resolve("lab", "1.x")).rejects.toThrow(TypeError);
  });

  it("resolves an exact prerelease without fetching tags or requiring optional fields", async () => {
    const { client, requests } = fixtureClient(() => ({
      ...manifest("lab", "2.0.0-rc.1"),
      deprecated: "old",
    }));
    expect(await client.resolve("lab", "2.0.0-rc.1")).toMatchObject({
      name: "lab",
      version: "2.0.0-rc.1",
      integrity,
      observedTags: {},
    });
    expect(requests).toHaveLength(1);
  });

  it("lists exact versions in descending semver order using abbreviated metadata", async () => {
    const { client } = fixtureClient((_url, init) => {
      expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.npm.install-v1+json");
      expect(init).toMatchObject({ credentials: "omit", redirect: "manual" });
      return {
        name: "lab",
        versions: { "2.0.0-rc.1": {}, "1.9.0": {}, "2.0.0": {}, latest: {} },
        "dist-tags": { latest: "2.0.0", invalid: "^1" },
      };
    });
    expect(await client.versions("lab")).toEqual({
      versions: ["2.0.0", "2.0.0-rc.1", "1.9.0"],
      tags: { latest: "2.0.0" },
    });
  });

  it.each([
    {},
    { name: "other", version: "1.0.0", dist: {} },
    { ...manifest("lab", "1.0.0"), version: "2.0.0" },
  ])("rejects inconsistent selected manifests", async (value) => {
    const { client } = fixtureClient(() => value);
    await expect(client.resolve("lab", "1.0.0")).rejects.toMatchObject({
      classification: "package_manifest_invalid",
    });
  });

  it("does not resolve inherited or missing tags", async () => {
    const { client, requests } = fixtureClient(() => ({ name: "lab", versions: {} }));
    await expect(client.resolve("lab", "constructor")).rejects.toMatchObject({
      classification: "package_version_not_found",
    });
    expect(requests).toHaveLength(1);
  });

  it("bounds search results and only exposes safe optional links", async () => {
    const { client } = fixtureClient((url) => {
      expect(url.searchParams.get("text")).toBe("@scope/lab");
      expect(url.searchParams.get("size")).toBe("3");
      return {
        objects: [
          {
            package: {
              name: "lab",
              version: "1.0.0",
              links: { repository: "javascript:alert(1)" },
            },
          },
          {
            package: {
              name: "@scope/lab",
              version: "1.0.0",
              links: { repository: "https://github.com/org/lab" },
            },
          },
          { package: { name: "../evil", version: "1.0.0" } },
          { package: { name: "extra", version: "1.0.0" } },
        ],
      };
    });
    expect(await client.search("@scope/lab", 3)).toEqual([
      { name: "lab", version: "1.0.0" },
      { name: "@scope/lab", version: "1.0.0", repositoryUrl: "https://github.com/org/lab" },
    ]);
  });
});

describe("artifact validation", () => {
  it.each(["../lab", "https://example.com", "lab?x=1", "a".repeat(215), "@scope"])(
    "rejects invalid names: %s",
    (name) => expect(() => assertPackageName(name)).toThrow(TypeError),
  );
  it.each(["^1.0.0", "*", "../latest", "1.0.0 || 2.0.0", " latest"])(
    "rejects selectors: %s",
    (selector) => expect(() => assertSelector(selector)).toThrow(TypeError),
  );
  it.each([
    "http://registry.npmjs.org/lab.tgz",
    "https://example.com/lab.tgz",
    "https://user:pass@registry.npmjs.org/lab.tgz",
    "https://127.0.0.1/lab.tgz",
    "https://[::1]/lab.tgz",
    "https://registry.npmjs.org/lab.tgz?token=1",
    "https://registry.npmjs.org/lab.tgz#x",
    "https://registry.npmjs.org\\@evil/lab.tgz",
  ])("rejects unsupported artifact URLs: %s", (url) =>
    expect(() => registryTarballUrl(url)).toThrow(
      expect.objectContaining({ classification: "dependency_source_unsupported" }),
    ),
  );
  it.each([undefined, "sha1-YWJj", "sha512-YWJj", `${integrity} ${integrity}`])(
    "requires one usable strong digest",
    (value) =>
      expect(() => artifactIntegrity(value)).toThrow(
        expect.objectContaining({ classification: "artifact_integrity_unavailable" }),
      ),
  );
  it.each(["sha256", "sha384", "sha512"])(
    "accepts %s and selects the strongest supplied digest",
    (algorithm) => {
      const sri = `${algorithm}-${createHash(algorithm).update("fixture").digest("base64")}`;
      expect(artifactIntegrity(sri)).toBe(sri);
      if (algorithm !== "sha512") expect(artifactIntegrity(`${sri} ${integrity}`)).toBe(integrity);
    },
  );
});

let serve: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => serve(request, response));
let origin: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no address.");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const fixtureFetch: typeof fetch = (input, init) =>
  fetch(new URL(new URL(String(input)).pathname, origin), init);
const request = (http: RegistryHttp, maxBytes = 1024, signal?: AbortSignal) =>
  http.json(new URL("https://registry.npmjs.org/lab"), {
    accept: "application/json",
    notFound: "package_not_found",
    maxBytes,
    ...(signal ? { signal } : {}),
  });

describe("bounded HTTP over a real mock registry", () => {
  it("does not follow redirects or retry missing packages", async () => {
    for (const status of [302, 404]) {
      let count = 0;
      serve = (_req, res) => {
        count++;
        res.writeHead(status, { Location: "/secret" }).end();
      };
      await expect(
        request(new RegistryHttp({ fetch: fixtureFetch, retryDelayMs: 0 })),
      ).rejects.toMatchObject({
        classification: status === 404 ? "package_not_found" : "registry_unavailable",
        retryable: false,
      });
      expect(count).toBe(1);
    }
  });

  it.each([429, 503])("bounds retries for status %s", async (status) => {
    let count = 0;
    serve = (_req, res) => {
      count++;
      res.writeHead(status).end();
    };
    await expect(
      request(new RegistryHttp({ fetch: fixtureFetch, retryDelayMs: 0 })),
    ).rejects.toMatchObject({ classification: "registry_unavailable", retryable: true });
    expect(count).toBe(3);
  });

  it("recovers from a transient failure without sending credentials", async () => {
    let count = 0;
    serve = (req, res) => {
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.cookie).toBeUndefined();
      count++;
      res
        .writeHead(count === 1 ? 500 : 200, { "Content-Type": "application/json" })
        .end('{"ok":true}');
    };
    expect(await request(new RegistryHttp({ fetch: fixtureFetch, retryDelayMs: 0 }))).toEqual({
      ok: true,
    });
    expect(count).toBe(2);
  });

  it.each(["declared", "streamed", "gzip"])(
    "enforces decoded byte limits on %s responses",
    async (kind) => {
      serve = (_req, res) => {
        const data = Buffer.from(JSON.stringify("a".repeat(5000)));
        res.setHeader("Content-Type", "application/json");
        if (kind === "declared") res.setHeader("Content-Length", data.length);
        if (kind === "gzip") {
          res.setHeader("Content-Encoding", "gzip");
          res.end(gzipSync(data));
        } else {
          res.write(data.subarray(0, 20));
          res.end(data.subarray(20));
        }
      };
      await expect(request(new RegistryHttp({ fetch: fixtureFetch }), 100)).rejects.toMatchObject({
        classification: "preparation_limit_exceeded",
      });
    },
  );

  it("accepts gzip whose encoded size exceeds the decoded limit", async () => {
    const data = Buffer.from(JSON.stringify("a".repeat(98)));
    const encoded = gzipSync(data, { level: 0 });
    expect(encoded.byteLength).toBeGreaterThan(data.byteLength);
    serve = (_req, res) =>
      res
        .writeHead(200, {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": encoded.byteLength,
        })
        .end(encoded);
    expect(await request(new RegistryHttp({ fetch: fixtureFetch }), data.byteLength)).toBe(
      "a".repeat(98),
    );
  });

  it.each([Buffer.from("{"), Buffer.from([0xff, 0xfe])])(
    "rejects malformed JSON and UTF-8",
    async (bytes) => {
      serve = (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(bytes);
      await expect(request(new RegistryHttp({ fetch: fixtureFetch }))).rejects.toMatchObject({
        classification: "package_manifest_invalid",
      });
    },
  );

  it.each([
    `${"[".repeat(MAX_JSON_DEPTH + 1)}0${"]".repeat(MAX_JSON_DEPTH + 1)}`,
    JSON.stringify({ description: "a".repeat(MAX_JSON_STRING_BYTES + 1) }),
  ])("rejects structural limits below the response byte cap", async (json) => {
    serve = (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(json);
    await expect(
      request(new RegistryHttp({ fetch: fixtureFetch }), 1024 * 1024),
    ).rejects.toMatchObject({ classification: "preparation_limit_exceeded" });
  });

  it("includes stalled response bodies in the deadline", async () => {
    serve = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("{");
    };
    await expect(
      request(new RegistryHttp({ fetch: fixtureFetch, timeoutMs: 100 })),
    ).rejects.toMatchObject({ classification: "registry_unavailable" });
  });

  it("honors cancellation and aborts a retry delay at the overall deadline", async () => {
    let count = 0;
    serve = (_req, res) => {
      count++;
      res.writeHead(429, { "Retry-After": "99999" }).end();
    };
    await expect(
      request(new RegistryHttp({ fetch: fixtureFetch, timeoutMs: 100 })),
    ).rejects.toMatchObject({ classification: "registry_unavailable" });
    expect(count).toBe(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      request(new RegistryHttp({ fetch: fixtureFetch }), 100, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(count).toBe(1);
  });
});

describe("JSON token limits across stream chunks", () => {
  it("handles escaped quotes, backslashes, and braces inside strings", () => {
    const guard = new JsonStructureLimit();
    const bytes = Buffer.from(
      JSON.stringify({ value: `quoted " and backslash \\ ${"[{]}".repeat(100)}` }),
    );
    for (const byte of bytes) guard.write(Uint8Array.of(byte));
  });

  it("allows the exact string limit and rejects a later chunk", () => {
    const guard = new JsonStructureLimit();
    guard.write(Buffer.from(`"${"a".repeat(MAX_JSON_STRING_BYTES)}`));
    expect(() => guard.write(Buffer.from("x"))).toThrow(
      expect.objectContaining({ classification: "preparation_limit_exceeded" }),
    );
    const allowed = new JsonStructureLimit();
    expect(() =>
      allowed.write(Buffer.from(JSON.stringify("a".repeat(MAX_JSON_STRING_BYTES)))),
    ).not.toThrow();
  });

  it("counts escaped source bytes and nested arrays without recursion", () => {
    const guard = new JsonStructureLimit();
    guard.write(Buffer.from("[".repeat(MAX_JSON_DEPTH)));
    expect(() => guard.write(Buffer.from("["))).toThrow();
    const escaped = new JsonStructureLimit();
    expect(() => escaped.write(Buffer.from(`"${"\\u0061".repeat(12000)}"`))).toThrow();
  });
});
