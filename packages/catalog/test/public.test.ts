import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MetadataBusy, MetadataCache } from "../src/public/cache.js";
import { publicConfigSchema, readAdmissionBody, requesterKey } from "../src/public/security.js";

const config = publicConfigSchema.parse({
  origin: "https://compatlab.example",
  matrixId: randomUUID(),
  requesterSecret: "a".repeat(64),
  proxySecret: "b".repeat(64),
  scansEnabled: true,
});
function request(ip: string, proxy = config.proxySecret) {
  return new Request(config.origin, {
    headers: { "x-compatlab-client-ip": ip, "x-compatlab-proxy-token": proxy ?? "" },
  });
}
describe("bounded public metadata cache", () => {
  it("coalesces concurrent loads and expires metadata without retaining failures", async () => {
    let now = 0,
      calls = 0;
    const cache = new MetadataCache(() => now);
    const load = async () => ++calls;
    expect(await Promise.all(Array.from({ length: 20 }, () => cache.get("package", load)))).toEqual(
      Array(20).fill(1),
    );
    now = 60_001;
    expect(await cache.get("package", load)).toBe(2);
    await expect(
      cache.get("failure", async () => {
        throw new Error("Offline");
      }),
    ).rejects.toThrow("Offline");
    expect(await cache.get("failure", async () => "recovered")).toBe("recovered");
  });
  it("bounds both pending registry work and cached bytes", async () => {
    const cache = new MetadataCache();
    const pending = Promise.withResolvers<string>();
    const loads = [0, 1, 2, 3].map((value) => cache.get(String(value), () => pending.promise));
    await expect(cache.get("fifth", async () => "extra")).rejects.toBeInstanceOf(MetadataBusy);
    pending.resolve("ready");
    await Promise.all(loads);
    await cache.get("large-a", async () => "x".repeat(3 * 1024 * 1024));
    await cache.get("large-b", async () => "x".repeat(3 * 1024 * 1024));
    expect(await cache.get("large-a", async () => "evicted")).toBe("evicted");
  });
});
describe("anonymous mutation boundaries", () => {
  it("requires an authenticated proxy for non-loopback deployments", () => {
    expect(() => publicConfigSchema.parse({ ...config, proxySecret: undefined })).toThrow();
    expect(() => requesterKey(request("192.0.2.1", "wrong"), config)).toThrow("untrusted_proxy");
    expect(() => requesterKey(request("192.0.2.1, 192.0.2.2"), config)).toThrow(
      "invalid_client_address",
    );
  });
  it("rotates keyed pseudonyms daily and groups IPv6 clients by /64", () => {
    const day = new Date("2026-10-04T01:00:00Z"),
      next = new Date("2026-10-05T01:00:00Z");
    expect(requesterKey(request("2001:db8:abcd:12::1"), config, day)).toBe(
      requesterKey(request("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff"), config, day),
    );
    expect(requesterKey(request("192.0.2.1"), config, day)).not.toBe(
      requesterKey(request("192.0.2.1"), config, next),
    );
    expect(requesterKey(request("192.0.2.1"), config, day)).not.toContain("192.0.2");
  });
  it("treats IPv4-mapped addresses as their distinct IPv4 clients", () => {
    const day = new Date("2026-10-04T01:00:00Z");
    const first = requesterKey(request("192.0.2.1"), config, day);
    expect(requesterKey(request("::ffff:192.0.2.1"), config, day)).toBe(first);
    expect(requesterKey(request("::ffff:c000:201"), config, day)).toBe(first);
    expect(requesterKey(request("::ffff:198.51.100.9"), config, day)).not.toBe(first);
  });
  it("rejects cross-origin requests, non-JSON bodies and streamed overflow", async () => {
    const make = (body: string, headers: Record<string, string> = {}) =>
      new Request(config.origin, {
        method: "POST",
        headers: { origin: config.origin, "content-type": "application/json", ...headers },
        body,
      });
    await expect(
      readAdmissionBody(make("{}", { origin: "https://elsewhere.example" }), config.origin),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readAdmissionBody(make("{}", { "content-type": "text/plain" }), config.origin),
    ).rejects.toMatchObject({ status: 415 });
    await expect(readAdmissionBody(make("x".repeat(2049)), config.origin)).rejects.toMatchObject({
      status: 413,
    });
    await expect(readAdmissionBody(make("{broken"), config.origin)).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await readAdmissionBody(make('{"name":"fixture","version":"1.0.0"}'), config.origin),
    ).toEqual({ name: "fixture", version: "1.0.0" });
  });
});
