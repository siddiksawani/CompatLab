import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { migrateCatalog, openCatalog } from "../packages/catalog/dist/index.js";

assert.equal(process.platform, "linux");
const execute = promisify(execFile),
  suffix = randomUUID().slice(0, 8),
  prefix = `compatlab-ops-${suffix}`;
const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
const config = join(directory, "config"),
  release = join(directory, "release"),
  link = `cq${suffix}`;
const docker = (...args) =>
  execute("docker", args, { timeout: 900_000, maxBuffer: 16 * 1024 ** 2 });
const containers = [],
  started = performance.now();
let catalog;
async function ready(url, status = 200) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status === status) return response;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Service failed readiness: ${new URL(url).pathname}`);
}
async function container(name, ...args) {
  containers.push(name);
  return docker("run", "--detach", "--name", name, ...args);
}
async function port(name, key) {
  return JSON.parse((await docker("inspect", name)).stdout)[0].NetworkSettings.Ports[key][0]
    .HostPort;
}
const values = async (file) =>
  Object.fromEntries(
    (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
try {
  await execute(process.execPath, ["infra/configure.mjs", "qualification.invalid", config]);
  await execute("bash", ["infra/build-release.sh", release], {
    timeout: 900_000,
    maxBuffer: 16 * 1024 ** 2,
  });
  const images = await values(join(release, "release.env"));
  const executionAssets = [
    "harnesses/probe.mjs",
    "harnesses/assertion.mjs",
    "runtime-images/Dockerfile",
  ];
  const packagedAssets = await docker(
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    images.COMPATLAB_CONTROL_IMAGE,
    "node",
    "--input-type=module",
    "-e",
    `import { readFile } from 'node:fs/promises';
     await import('./services/worker/dist/index.js');
     console.log(JSON.stringify(await Promise.all(${JSON.stringify(executionAssets)}.map(path => readFile(path, 'utf8')))));`,
  );
  assert.deepEqual(
    JSON.parse(packagedAssets.stdout),
    await Promise.all(executionAssets.map((path) => readFile(path, "utf8"))),
  );
  await docker("network", "create", prefix);
  await container(
    `${prefix}-db`,
    "--network",
    prefix,
    "--network-alias",
    "postgres",
    "--publish",
    "127.0.0.1::5432",
    "--env-file",
    join(config, "postgres.env"),
    "--mount",
    `type=bind,src=${resolve("infra/init-database.sh")},dst=/docker-entrypoint-initdb.d/roles.sh,readonly`,
    "--memory",
    "1g",
    "postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650",
  );
  const databasePort = await port(`${prefix}-db`, "5432/tcp");
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 60, "Database did not start.");
    try {
      await docker(
        "exec",
        `${prefix}-db`,
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
  const migration = new URL((await readFile(join(config, "migration-url"), "utf8")).trim());
  migration.port = databasePort;
  catalog = openCatalog(migration.href);
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
  await catalog.pool.query(await readFile("infra/grants.sql", "utf8"));
  const hardened = [
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
  ];
  await container(
    `${prefix}-web`,
    "--network",
    prefix,
    "--network-alias",
    "web",
    "--publish",
    "127.0.0.1::3000",
    "--env-file",
    join(config, "web.env"),
    ...hardened,
    "--memory",
    "768m",
    images.COMPATLAB_WEB_IMAGE,
  );
  const webPort = await port(`${prefix}-web`, "3000/tcp");
  await ready(`http://127.0.0.1:${webPort}/healthz`);
  await container(
    `${prefix}-proxy`,
    "--network",
    prefix,
    "--publish",
    "127.0.0.1::8080",
    "--env-file",
    join(config, "proxy.env"),
    "--env",
    "PUBLIC_DOMAIN=http://:8080",
    "--env",
    "PUBLIC_WWW_DOMAIN=http://:8081",
    "--mount",
    `type=bind,src=${resolve("infra/Caddyfile")},dst=/etc/caddy/Caddyfile,readonly`,
    "--tmpfs",
    "/data",
    "--tmpfs",
    "/config",
    ...hardened,
    "--cap-add",
    "NET_BIND_SERVICE",
    "--memory",
    "256m",
    images.COMPATLAB_PROXY_IMAGE,
  );
  const origin = `http://127.0.0.1:${await port(`${prefix}-proxy`, "8080/tcp")}`;
  const health = await ready(`${origin}/healthz`);
  assert.doesNotMatch(health.headers.get("cache-control") ?? "", /no-transform/);
  let assetPath;
  for (const path of ["/", "/methodology", "/api", "/privacy", "/terms", "/security"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /script-src 'self' 'nonce-/,
    );
    const cacheControl = response.headers.get("cache-control") ?? "";
    assert.match(cacheControl, /\bno-transform\b/);
    assert.match(cacheControl, /\bno-store\b/);
    const vary = (response.headers.get("vary") ?? "").toLowerCase().split(/,\s*/);
    assert.ok(vary.includes("accept"));
    assert.ok(vary.includes("rsc"));
    const html = await response.text();
    assert.ok(html.length > 200);
    if (path === "/") assetPath = html.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
  }
  const markdown = await fetch(`${origin}/`, { headers: { accept: "text/markdown" } });
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.ok((markdown.headers.get("vary") ?? "").toLowerCase().split(/,\s*/).includes("accept"));
  assert.match(markdown.headers.get("cache-control") ?? "", /no-store/);
  assert.match(await markdown.text(), /# CompatLab/);
  assert.ok(assetPath, "The homepage must reference a built JavaScript asset.");
  const [asset, directAsset] = await Promise.all([
    fetch(`${origin}${assetPath}`),
    fetch(`http://127.0.0.1:${webPort}${assetPath}`),
  ]);
  assert.equal(asset.status, 200);
  assert.equal(directAsset.status, 200);
  assert.match(asset.headers.get("cache-control") ?? "", /\bimmutable\b/);
  assert.equal(asset.headers.get("cache-control"), directAsset.headers.get("cache-control"));
  const oversized = await fetch(`${origin}/api/v1/scans`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://qualification.invalid" },
    body: JSON.stringify({ payload: "a".repeat(32_000) }),
  });
  assert.equal(oversized.status, 413);
  await execute("sudo", ["ip", "link", "add", link, "type", "wireguard"]);
  await execute("sudo", ["ip", "address", "add", "10.254.44.1/32", "dev", link]);
  await execute("sudo", ["ip", "link", "set", link, "up"]);
  const control = await values(join(config, "control.env")),
    controlUrl = new URL(control.DATABASE_URL);
  controlUrl.port = databasePort;
  const controlFile = join(config, "qualification-control.env");
  await writeFile(
    controlFile,
    `DATABASE_URL=${controlUrl.href}\nCONTROL_BIND_ADDRESS=10.254.44.1\nCONTROL_WIREGUARD_INTERFACE=${link}\nCONTROL_PORT=4879\n`,
    { mode: 0o600 },
  );
  await container(
    `${prefix}-control`,
    "--network",
    "host",
    "--env-file",
    controlFile,
    ...hardened,
    "--memory",
    "512m",
    images.COMPATLAB_CONTROL_IMAGE,
  );
  await ready("http://10.254.44.1:4879/", 404);
  assert.equal(
    (await fetch("http://10.254.44.1:4879/v1/jobs/claim", { method: "POST" })).status,
    401,
  );
  await assert.rejects(() =>
    fetch("http://127.0.0.1:4879/", { signal: AbortSignal.timeout(1000) }),
  );
  const adminUrl = new URL((await readFile(join(config, "operator-url"), "utf8")).trim());
  adminUrl.port = databasePort;
  const adminFile = join(config, "qualification-operator-url");
  await writeFile(adminFile, adminUrl.href, { mode: 0o600 });
  const status = await docker(
    "run",
    "--rm",
    "--network",
    "host",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    ...hardened,
    "--env",
    "ADMIN_DATABASE_URL_FILE=/run/credential",
    "--mount",
    `type=bind,src=${adminFile},dst=/run/credential,readonly`,
    images.COMPATLAB_CONTROL_IMAGE,
    "node",
    "apps/cli/dist/bin.js",
    "admin",
    "status",
  );
  assert.equal(JSON.parse(status.stdout).health.admissionPaused, false);
  await sleep(6500);
  const logs = (await docker("logs", `${prefix}-control`)).stderr;
  assert.ok(!logs.includes("failed"), "Control reconciliation or retention failed.");
  await docker("stop", `${prefix}-web`);
  const marker = "private-query-sentinel",
    unavailable = await fetch(`${origin}/?secret=${marker}`, {
      headers: { authorization: `Bearer ${marker}`, cookie: `session=${marker}` },
    });
  assert.equal(unavailable.status, 502);
  const proxyLogs = await docker("logs", `${prefix}-proxy`);
  assert.ok(
    !(proxyLogs.stdout + proxyLogs.stderr).includes(marker),
    "Proxy errors retained private request data.",
  );
  await mkdir("test-results", { recursive: true });
  const evidence = {
    qualified: true,
    elapsedMs: Math.round(performance.now() - started),
    services: [
      "PostgreSQL roles",
      "standalone web",
      "Caddy 2.11.7",
      "WireGuard-bound control",
      "restricted operator CLI",
      "packaged worker execution assets",
    ],
    checks: [
      "readiness",
      "security headers",
      "HTML and Markdown variants through Caddy",
      "policy pages",
      "16 KiB ingress bound",
      "worker authentication",
      "private binding",
      "maintenance permissions",
      "proxy error redaction",
    ],
    images,
  };
  await writeFile("test-results/deployment.json", JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await catalog?.close();
  for (const name of containers.reverse())
    await docker("rm", "--force", "--volumes", name).catch(() => {});
  await docker("network", "rm", prefix).catch(() => {});
  await execute("sudo", ["ip", "link", "delete", link]).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
