import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { admitScan, openCatalog, operationStatus } from "../src/index.js";
import { artifact, database, migrateCatalog, options, seedMatrix } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let clients: ReturnType<typeof openCatalog>[] = [];
let matrixId: string;
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
  matrixId = (await seedMatrix(catalog.db)).matrixId;
  clients = Array.from({ length: 4 }, () => openCatalog(catalog.address));
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await catalog?.dispose();
});
it("bounds a burst across four independent admission pools and preserves read capacity", async () => {
  const durations: number[] = [];
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 40 }, async (_, index) => {
      const begin = performance.now();
      const result = await admitScan(
        (clients[index % clients.length] ?? catalog).db,
        artifact(),
        options(matrixId),
      );
      durations.push(performance.now() - begin);
      return result;
    }),
  );
  expect(results.filter((row) => row.kind === "admitted")).toHaveLength(20);
  expect(
    results.filter((row) => row.kind === "throttled" && row.reason === "queue_full"),
  ).toHaveLength(20);
  const reads = performance.now();
  const status = await operationStatus(catalog.db);
  const statusMs = Math.round(performance.now() - reads);
  expect(status.queue).toMatchObject([{ state: "requested", count: 20 }]);
  expect(catalog.pool.waitingCount).toBe(0);
  durations.sort((a, b) => a - b);
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/admission-saturation.json",
    JSON.stringify(
      {
        requests: 40,
        clients: 4,
        admitted: 20,
        throttled: 20,
        elapsedMs: Math.round(performance.now() - started),
        p50Ms: Math.round(durations[19] ?? 0),
        p95Ms: Math.round(durations[37] ?? 0),
        statusMs,
        scope: "Catalog admission burst; no package execution or sustained-load claim.",
      },
      null,
      2,
    ),
  );
}, 30_000);
