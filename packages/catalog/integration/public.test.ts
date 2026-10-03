import { RegistryClient } from "@compatlab/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPublicApi, migrateCatalog, schema } from "../src/index.js";
import { artifact, database, seedMatrix } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let api: ReturnType<typeof createPublicApi>;
let calls = 0;
const origin = "http://127.0.0.1:3000";
const source = artifact("@scope/public-fixture");
const registry = new RegistryClient({
  fetch: async (input) => {
    calls++;
    const url = new URL(String(input));
    if (url.pathname === "/-/v1/search")
      return Response.json({
        objects: [
          {
            package: {
              name: source.name,
              version: source.version,
              description: "<script>inert</script>",
            },
          },
        ],
      });
    if (decodeURIComponent(url.pathname) === `/${source.name}`)
      return Response.json({
        name: source.name,
        versions: { "1.0.0": {}, "2.0.0": {} },
        "dist-tags": { latest: "1.0.0" },
      });
    if (decodeURIComponent(url.pathname) === `/${source.name}/1.0.0`)
      return Response.json({
        ...source.manifest,
        deprecated: "Use a maintained version.",
        dist: { integrity: source.integrity, tarball: source.tarballUrl },
      });
    return new Response("missing", { status: 404 });
  },
});
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
});
afterAll(async () => {
  await catalog?.dispose();
});
beforeEach(async () => {
  await catalog.pool.query(
    "TRUNCATE audit_events,blocks,reports,jobs,runs,scans,matrix_members,matrices,runtime_images,preparations,workers,package_versions,packages CASCADE",
  );
  const matrix = await seedMatrix(catalog.db);
  api = createPublicApi(
    catalog.db,
    { origin, matrixId: matrix.matrixId, requesterSecret: "a".repeat(64), scansEnabled: true },
    registry,
  );
  calls = 0;
});
function post(value: unknown, headers: Record<string, string> = {}) {
  return api(
    new Request(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(value),
    }),
  );
}
describe("public discovery and scan admission", () => {
  it("returns bodyless HEAD responses for successful and failed discovery", async () => {
    for (const path of ["search?q=fixture", "packages?name=missing", "missing"]) {
      const get = await api(new Request(`${origin}/api/v1/${path}`));
      const head = await api(new Request(`${origin}/api/v1/${path}`, { method: "HEAD" }));
      expect(head.status).toBe(get.status);
      expect(await head.text()).toBe("");
    }
  });
  it("supports scoped discovery and selected versions without creating any package work", async () => {
    const search = await api(new Request(`${origin}/api/v1/search?q=%40scope`));
    expect(await search.json()).toMatchObject({
      packages: [{ name: source.name, reportId: null }],
    });
    const path = `${origin}/api/v1/packages?${new URLSearchParams({ name: source.name, version: source.version })}`;
    const result = await api(new Request(path));
    expect(await result.json()).toMatchObject({
      name: source.name,
      version: source.version,
      deprecated: "Use a maintained version.",
      repositoryUrl: null,
      reportId: null,
      scanId: null,
    });
    const requests = calls;
    expect((await api(new Request(path))).status).toBe(200);
    expect(calls).toBe(requests);
    expect(await catalog.db.select().from(schema.scans)).toEqual([]);
    expect(await catalog.db.select().from(schema.jobs)).toEqual([]);
  });
  it("converges concurrent explicit submissions and restores progress", async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => post({ name: source.name, version: source.version })),
    );
    expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
    expect(responses.every((response) => [200, 202].includes(response.status))).toBe(true);
    const [scan] = await catalog.db.select().from(schema.scans);
    expect(await catalog.db.select().from(schema.jobs)).toHaveLength(1);
    const response = await api(new Request(`${origin}/api/v1/scans/${scan?.id}`));
    expect(await response.json()).toMatchObject({
      id: scan?.id,
      state: "requested",
      jobs: { queued: 1 },
    });
    expect(
      (
        await api(
          new Request(`${origin}/api/v1/scans/${scan?.id}`, {
            headers: { "if-none-match": response.headers.get("etag") ?? "" },
          }),
        )
      ).status,
    ).toBe(304);
  });
  it("rejects moving tags, unknown fields, unavailable artifacts, and cross-site submissions before work", async () => {
    expect((await post({ name: source.name, version: "latest" })).status).toBe(400);
    expect(
      (await post({ name: source.name, version: source.version, command: "arbitrary" })).status,
    ).toBe(400);
    expect((await post({ name: source.name, version: "3.0.0" })).status).toBe(404);
    expect(
      (
        await post(
          { name: source.name, version: source.version },
          { origin: "https://elsewhere.example" },
        )
      ).status,
    ).toBe(403);
    expect(await catalog.db.select().from(schema.jobs)).toEqual([]);
  });
});
