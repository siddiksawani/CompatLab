import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { decryptBackup } from "../apps/cli/dist/backup.js";
import {
  migrateCatalog,
  openCatalog,
  registerMatrix,
  registerRuntime,
} from "../packages/catalog/dist/index.js";

import {
  RUNTIME_BASE_IMAGE,
  RUNTIME_PROFILES,
  RUNTIME_SUPPORT_IMAGE,
} from "../packages/engine/dist/index.js";

const target = process.argv[2];
assert.match(target ?? "", /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*:\/[a-zA-Z0-9_./-]+$/);
assert.ok(!target.split(":")[1].split("/").includes(".."));
const suffix = randomUUID().slice(0, 8),
  container = `compatlab-backup-${suffix}`;
const directory = await mkdtemp(join(tmpdir(), "compatlab-backup-qualification-"));
const config = join(directory, "config"),
  execute = promisify(execFile);
const docker = (...args) => execute("docker", args, { timeout: 120_000, maxBuffer: 2 * 1024 ** 2 });
const postgres =
  "postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";
let catalog, restored, uploaded;
const started = performance.now();
try {
  await execute(process.execPath, ["infra/configure.mjs", "qualification.invalid", config]);
  await docker(
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env-file",
    join(config, "postgres.env"),
    "--memory",
    "1g",
    "--cpus",
    "2",
    postgres,
  );
  const binding = JSON.parse((await docker("inspect", container)).stdout)[0].NetworkSettings.Ports[
    "5432/tcp"
  ][0];
  const credential = (await readFile(join(config, "migration-url"), "utf8")).trim();
  const url = new URL(credential);
  url.port = binding.HostPort;
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 60, "PostgreSQL failed to start.");
    try {
      await docker(
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        "compatlab",
      );
      break;
    } catch {
      await sleep(500);
    }
  }
  catalog = openCatalog(url.href);
  for (let attempt = 0; ; attempt++) {
    try {
      await catalog.pool.query("SELECT 1");
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await sleep(250);
    }
  }
  await migrateCatalog(catalog.pool);
  const pkg = (
    await catalog.pool.query("INSERT INTO packages(name) VALUES('restore-fixture') RETURNING id")
  ).rows[0].id;
  const artifact = (
    await catalog.pool.query(
      "INSERT INTO package_versions(package_id,version,integrity,tarball_url,manifest) VALUES($1,'1.0.0','sha512-fixture','https://registry.npmjs.org/restore-fixture/-/restore-fixture-1.0.0.tgz','{}') RETURNING id",
      [pkg],
    )
  ).rows[0].id;
  const preparation = (
    await catalog.pool.query(
      "INSERT INTO preparations(artifact_id,profile_revision,platform,lock_bytes,lock_digest) VALUES($1,'restore_fixture','linux_amd64_glibc',$2,$3) RETURNING id",
      [
        artifact,
        Buffer.from('{"lockfileVersion":3}'),
        createHash("sha256").update('{"lockfileVersion":3}').digest("hex"),
      ],
    )
  ).rows[0].id;
  const actor = { actor: "qualification", reason: "Backup restoration fixture." };
  const profile = RUNTIME_PROFILES[0];
  const imageId = await registerRuntime(
    catalog.db,
    {
      profileId: profile.id,
      kind: profile.kind,
      version: profile.version,
      imageId: `sha256:${"a".repeat(64)}`,
      builtAt: new Date().toISOString(),
      sourceImage: profile.sourceImage,
      baseImage: RUNTIME_BASE_IMAGE,
      supportImage: RUNTIME_SUPPORT_IMAGE,
      platform: "linux_amd64_glibc",
      recipeRevision: "runtime_image_v1",
    },
    actor,
  );
  const matrix = await registerMatrix(
    catalog.db,
    {
      revision: "restore_fixture",
      preparationProfile: "restore_fixture",
      harnessRevision: "load_v2",
      planRevision: "explicit_exports_v1",
      policyRevision: "runtime_limits_v2",
      imageIds: [imageId],
    },
    actor,
  );
  const scan = (
    await catalog.pool.query(
      "INSERT INTO scans(preparation_id,matrix_id,state,admission_policy) VALUES($1,$2,'completed','restore_fixture') RETURNING id",
      [preparation, matrix],
    )
  ).rows[0].id;
  await catalog.pool.query(
    "INSERT INTO reports(scan_id,classifier_revision,payload) VALUES($1,'classifier_v1',$2)",
    [scan, { schemaVersion: 1, purpose: "restore fixture", exactIdentity: artifact }],
  );
  await catalog.pool.query(
    "INSERT INTO audit_events(actor,reason,action,details) VALUES('qualification','Restore evidence fixture.','restore_fixture','{}')",
  );
  const evidenceQuery =
    "SELECT jsonb_build_object('reports',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM reports r),'preparations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM preparations p),'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE action='restore_fixture'),'migrations',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM schema_migrations m)) AS evidence";
  const expected = (await catalog.pool.query(evidenceQuery)).rows[0].evidence;
  const operator = join(config, "qualification-url");
  await writeFile(operator, url.href, { mode: 0o600 });
  const result = await execute(process.execPath, ["infra/backup.mjs"], {
    env: {
      ...process.env,
      BACKUP_DIRECTORY: join(directory, "archives"),
      BACKUP_KEY_FILE: join(config, "backup-key"),
      BACKUP_POSTGRES_CONTAINER: container,
      BACKUP_SSH_TARGET: target,
      ADMIN_DATABASE_URL_FILE: operator,
    },
    timeout: 120_000,
  });
  uploaded = JSON.parse(result.stdout);
  assert.equal(uploaded.uploaded, true);
  const archive = join(directory, "retrieved.clb"),
    dump = join(directory, "restored.dump");
  await execute(
    "scp",
    ["-oBatchMode=yes", "-oStrictHostKeyChecking=yes", `${target}/${uploaded.file}`, archive],
    { timeout: 120_000 },
  );
  const restoreStarted = performance.now();
  await decryptBackup(archive, dump, join(config, "backup-key"));
  await docker(
    "run",
    "--detach",
    "--name",
    `${container}-restored`,
    "--publish",
    "127.0.0.1::5432",
    "--env-file",
    join(config, "postgres.env"),
    "--memory",
    "1g",
    postgres,
  );
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 60, "Restore instance failed to start.");
    try {
      await docker(
        "exec",
        `${container}-restored`,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        "compatlab",
      );
      break;
    } catch {
      await sleep(500);
    }
  }
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      `${container}-restored`,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      "compatlab",
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let error = "";
  child.stderr.on("data", (bytes) => {
    error = (error + bytes.toString()).slice(-4096);
  });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(error))));
  });
  createReadStream(dump).pipe(child.stdin);
  await exited;
  url.port = JSON.parse(
    (await docker("inspect", `${container}-restored`)).stdout,
  )[0].NetworkSettings.Ports["5432/tcp"][0].HostPort;
  restored = openCatalog(url.href);
  assert.deepEqual((await restored.pool.query(evidenceQuery)).rows[0].evidence, expected);
  assert.equal(
    (
      await catalog.pool.query(
        "SELECT count(*)::int n FROM audit_events WHERE action='backup_uploaded'",
      )
    ).rows[0].n,
    1,
  );
  await migrateCatalog(restored.pool);
  await mkdir("test-results", { recursive: true });
  const evidence = {
    qualified: true,
    encryptedBytes: uploaded.bytes,
    checksum: uploaded.digest,
    verified: ["reports", "exact locks", "audit events", "migration checksums"],
    restoredIntoFreshInstance: true,
    restoreMs: Math.round(performance.now() - restoreStarted),
    elapsedMs: Math.round(performance.now() - started),
    transport: target.startsWith("localhost:") ? "loopback SSH regression" : "off-host SSH drill",
  };
  await writeFile(resolve("test-results/backup-restore.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await Promise.all([catalog?.close(), restored?.close()]);
  await docker("rm", "--force", "--volumes", container, `${container}-restored`).catch(() => {});
  if (uploaded) {
    const [host, path] = target.split(":");
    await execute(
      "ssh",
      ["-oBatchMode=yes", "-oStrictHostKeyChecking=yes", host, `rm -- '${path}/${uploaded.file}'`],
      { timeout: 15_000 },
    );
  }
  await rm(directory, { recursive: true, force: true });
}
