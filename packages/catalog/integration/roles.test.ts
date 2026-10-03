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
it("audits direct operator writes and prevents forged database audit origins", async () => {
  await operator.pool.query("UPDATE service_controls SET admission_paused=false");
  const records = (
    await catalog.pool.query(
      "SELECT actor,details FROM audit_events WHERE action='operator_database_mutation' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows;
  expect(records[0]).toMatchObject({
    actor: `database:${roles[2]}`,
    details: { table: "service_controls", operation: "UPDATE", rowId: "singleton" },
  });
  await expect(operator.pool.query("DELETE FROM jobs")).rejects.toMatchObject({ code: "42501" });
  await expect(
    operator.pool.query("UPDATE schema_migrations SET checksum='forged'"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    operator.pool.query(
      "INSERT INTO audit_events(actor,reason,action,details) VALUES('forged','Forged audit.','operator_database_mutation','{}')",
    ),
  ).rejects.toThrow("cannot be supplied");
  await operator.pool.query(
    "INSERT INTO audit_events(actor,reason,action,details,created_at) VALUES('forged','Forged timestamp.','backdated_annotation','{}','2000-01-01')",
  );
  const backdated = (
    await catalog.pool.query(
      "SELECT actor,created_at FROM audit_events WHERE action='backdated_annotation'",
    )
  ).rows[0];
  expect(backdated.actor).toBe(`database:${roles[2]}`);
  expect(new Date(backdated.created_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  await operator.pool.query(
    "INSERT INTO audit_events(actor,reason,action,details) VALUES('claimed-user','Operator annotation.','annotation','{}')",
  );
  expect(
    (await catalog.pool.query("SELECT actor,details FROM audit_events WHERE action='annotation'"))
      .rows[0],
  ).toMatchObject({
    actor: `database:${roles[2]}`,
    details: { claimedActor: "claimed-user", databaseRole: roles[2] },
  });
});
it("separates maintainer credentials from control and operator access", async () => {
  const userId = randomUUID();
  await web.pool.query(
    "INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,'maintainer','fixture@example.com',true)",
    [userId],
  );
  await web.pool.query(
    "INSERT INTO auth_sessions(user_id,token,expires_at) VALUES($1,'fixture-session',now()+interval '1 day')",
    [userId],
  );
  await web.pool.query(
    "INSERT INTO auth_accounts(user_id,account_id,provider_id,access_token) VALUES($1,'12','github','encrypted-fixture')",
    [userId],
  );
  for (const client of [control, operator]) {
    await expect(client.pool.query("SELECT * FROM auth_accounts")).rejects.toThrow(
      "permission denied",
    );
    await expect(client.pool.query("SELECT token FROM auth_sessions")).rejects.toThrow(
      "permission denied",
    );
    await expect(client.pool.query("DELETE FROM auth_sessions")).rejects.toThrow("Only expired");
  }
  await web.pool.query("DELETE FROM auth_users WHERE id=$1", [userId]);
  expect(
    (await web.pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [userId])).rowCount,
  ).toBe(0);
});
it("keeps monitor destinations private while allowing the deployed scheduler role", async () => {
  const userId = randomUUID(),
    linkId = randomUUID(),
    monitorId = randomUUID();
  await web.pool.query(
    "INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,'maintainer','monitor@example.com',true)",
    [userId],
  );
  await web.pool.query(
    "INSERT INTO repository_links(id,user_id,repository_id,installation_id,full_name) VALUES($1,$2,'901','92','owner/package')",
    [linkId, userId],
  );
  await web.pool.query(
    "INSERT INTO monitors(id,user_id,repository_link_id,package_name,version_range,matrix_id,rule) VALUES($1,$2,$3,'fixture','*',$4,'regressions_only')",
    [monitorId, userId, linkId, matrixId],
  );
  await web.pool.query(
    "INSERT INTO monitor_releases(monitor_id,version,state) VALUES($1,'1.0.0','pending')",
    [monitorId],
  );
  for (const client of [control, operator])
    for (const table of [
      "monitors",
      "monitor_releases",
      "notifications",
      "notification_deliveries",
    ])
      await expect(client.pool.query(`SELECT * FROM ${table}`)).rejects.toThrow(
        "permission denied",
      );
  await web.pool.query("DELETE FROM auth_users WHERE id=$1", [userId]);
  expect((await web.pool.query("SELECT id FROM monitors WHERE id=$1", [monitorId])).rowCount).toBe(
    0,
  );
});
