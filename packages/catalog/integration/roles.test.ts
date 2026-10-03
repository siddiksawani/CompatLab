import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { admitScan, applyRetention, openCatalog, setAdmissionPaused } from "../src/index.js";
import { actor, artifact, database, migrateCatalog, options, seedMatrix } from "./fixtures.js";

let catalog: Awaited<ReturnType<typeof database>>;
let web: ReturnType<typeof openCatalog>;
let control: ReturnType<typeof openCatalog>;
let operator: ReturnType<typeof openCatalog>;
let matrixId: string;
const suffix = randomUUID().replaceAll("-", "");
const roles = ["web", "control", "operator"].map((role) => `qualification_${role}_${suffix}`);
beforeAll(async () => {
  catalog = await database();
  await migrateCatalog(catalog.pool);
  matrixId = (await seedMatrix(catalog.db)).matrixId;
  for (const role of roles) await catalog.pool.query(`CREATE ROLE "${role}"`);
  let grants = await readFile(new URL("../../../infra/grants.sql", import.meta.url), "utf8");
  for (const [index, role] of ["web", "control", "operator"].entries())
    grants = grants.replaceAll(`compatlab_${role}`, roles[index] ?? "");
  await catalog.pool.query(grants);
  const clients = roles.map((role) => {
    const url = new URL(catalog.address);
    url.searchParams.set("options", `-c role=${role}`);
    return openCatalog(url.href);
  });
  [web, control, operator] = clients as [typeof web, typeof control, typeof operator];
});
afterAll(async () => {
  await Promise.all([web?.close(), control?.close(), operator?.close()]);
  await catalog?.dispose();
  const admin = openCatalog(process.env.COMPATLAB_TEST_DATABASE_URL ?? "");
  try {
    for (const role of roles) await admin.pool.query(`DROP ROLE IF EXISTS "${role}"`);
  } finally {
    await admin.close();
  }
});
it("admits public work using the deployed web grants without operator authority", async () => {
  const source = artifact();
  expect(await admitScan(web.db, source, options(matrixId))).toMatchObject({ kind: "admitted" });
  expect(await admitScan(web.db, source, options(matrixId))).toMatchObject({ kind: "existing" });
  await expect(setAdmissionPaused(web.db, true, actor)).rejects.toMatchObject({
    cause: { code: "42501" },
  });
  await expect(web.pool.query("UPDATE workers SET accepting_jobs=false")).rejects.toThrow(
    "permission denied",
  );
  await expect(web.pool.query("CREATE TABLE forbidden(id int)")).rejects.toThrow(
    "permission denied",
  );
});
it("allows control maintenance and operator controls without superuser privileges", async () => {
  expect(await applyRetention(control.db, actor)).toEqual({ logs: 0, requesters: 0, audits: 0 });
  await expect(setAdmissionPaused(control.db, true, actor)).rejects.toMatchObject({
    cause: { code: "42501" },
  });
  await setAdmissionPaused(operator.db, true, actor);
  expect(await admitScan(web.db, artifact(), options(matrixId))).toMatchObject({
    kind: "throttled",
    reason: "admission_paused",
  });
  await expect(operator.pool.query("DELETE FROM audit_events")).rejects.toThrow("immutable");
});
