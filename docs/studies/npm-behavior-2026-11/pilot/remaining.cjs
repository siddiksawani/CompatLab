const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { writeFileSync, readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { once } = require("node:events");
const load = createRequire("/study/package.json");
const runtime = process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node";
const childArgs = (mode) => [
  ...(runtime === "deno"
    ? ["run", "-A", "--no-config", "--no-lock", "--node-modules-dir=manual", "--cached-only"]
    : []),
  "/pilot/child.cjs",
  mode,
];
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const checks = {
  async piscina() {
    const Piscina = load("piscina");
    const pool = new Piscina({ filename: "/pilot/worker-task.cjs", minThreads: 1, maxThreads: 2 });
    try {
      const results = await Promise.all([pool.run({ a: 20, b: 22 }), pool.run({ a: 19, b: 23 })]);
      assert.deepEqual(results, [
        { value: 42, runtime },
        { value: 42, runtime },
      ]);
    } finally {
      await pool.destroy();
    }
  },
  async workerpool() {
    const pool = load("workerpool").pool({ workerType: "thread", maxWorkers: 1 });
    try {
      const result = await pool.exec(
        function add(a, b) {
          return {
            value: a + b,
            runtime: process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node",
          };
        },
        [20, 22],
      );
      assert.deepEqual(result, { value: 42, runtime });
    } finally {
      await pool.terminate();
    }
  },
  async undici() {
    const { createServer } = require("node:http");
    const { request, Agent } = load("undici");
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url, value: 42 }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const agent = new Agent();
    try {
      const result = await request(`http://127.0.0.1:${server.address().port}/probe`, {
        dispatcher: agent,
      });
      assert.equal(result.statusCode, 200);
      assert.deepEqual(await result.body.json(), { path: "/probe", value: 42 });
    } finally {
      await agent.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
  async "http2-wrapper"() {
    const { createSecureServer } = require("node:http2");
    const wrapper = load("http2-wrapper");
    const server = createSecureServer({
      key: readFileSync("/pilot/localhost-key.pem"),
      cert: readFileSync("/pilot/localhost-cert.pem"),
    });
    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end(`${headers[":path"]} 42`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const agent = new wrapper.Agent({ maxSessions: 1 });
    try {
      const result = await new Promise((resolve, reject) => {
        const req = wrapper.get(
          `https://127.0.0.1:${server.address().port}/probe`,
          { agent, rejectUnauthorized: false, servername: "localhost" },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("error", reject);
            res.on("end", () => resolve({ body, status: res.statusCode }));
          },
        );
        req.on("error", reject);
      });
      assert.deepEqual(result, { body: "/probe 42", status: 200 });
    } finally {
      agent.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  },
  pirates() {
    const { addHook } = load("pirates");
    const path = "/study/hooked.js";
    writeFileSync(path, "module.exports = 41;");
    let called = 0;
    const revert = addHook(
      (code) => {
        called++;
        return code.replace("41", "42");
      },
      { exts: [".js"], matcher: (name) => name === path },
    );
    try {
      assert.equal(load(path), 42);
      assert.equal(called, 1);
    } finally {
      revert();
    }
    delete load.cache[path];
    assert.equal(load(path), 41);
  },
  async "import-fresh"() {
    const { default: createImportFresh } = await import(
      pathToFileURL(load.resolve("import-fresh")).href
    );
    writeFileSync("/study/increment.mjs", "let count = 0; export default () => ++count;");
    const fresh = createImportFresh("file:///study/probe.mjs");
    const first = (await fresh("./increment.mjs")).default;
    assert.equal(first(), 1);
    assert.equal(first(), 2);
    assert.equal((await fresh("./increment.mjs")).default(), 1);
  },
  async "cls-hooked"() {
    const cls = load("cls-hooked");
    const ns = cls.createNamespace("compatlab");
    const task = (value, delay) =>
      new Promise((resolve, reject) =>
        ns.run(() => {
          ns.set("value", value);
          setTimeout(() => {
            try {
              assert.equal(ns.get("value"), value);
              resolve(value);
            } catch (error) {
              reject(error);
            }
          }, delay);
        }),
      );
    try {
      assert.deepEqual(await Promise.all([task(17, 15), task(42, 5)]), [17, 42]);
    } finally {
      cls.destroyNamespace("compatlab");
    }
  },
  async "async-hook-domain"() {
    const { Domain } = load("async-hook-domain");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Domain did not catch the timer error")),
        5000,
      );
      const domain = new Domain((error) => {
        clearTimeout(timeout);
        domain.destroy();
        try {
          assert.equal(error.message, "compatlab expected timer error");
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      setTimeout(() => {
        throw new Error("compatlab expected timer error");
      }, 10);
    });
  },
  async "cross-spawn"() {
    const spawn = load("cross-spawn");
    const sync = spawn.sync(process.execPath, childArgs("ok"), { encoding: "utf8" });
    assert.equal(sync.status, 0, sync.stderr);
    assert.deepEqual(JSON.parse(sync.stdout), { value: 42, runtime });
    const child = spawn(process.execPath, childArgs("ok"));
    let body = "";
    child.stdout.on("data", (chunk) => {
      body += chunk;
    });
    const [code, signal] = await once(child, "close");
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.deepEqual(JSON.parse(body), { value: 42, runtime });
  },
  async execa() {
    const { execa } = await import(pathToFileURL(load.resolve("execa")).href);
    const result = await execa(process.execPath, childArgs("ok"));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), { value: 42, runtime });
    await assert.rejects(
      execa(process.execPath, childArgs("fail")),
      (error) => error.exitCode === 7,
    );
  },
  async "foreground-child"() {
    const { foregroundChild } = load("foreground-child");
    await new Promise((resolve, reject) => {
      const child = foregroundChild(
        process.execPath,
        childArgs("foreground-child"),
        (code, signal) => {
          try {
            assert.equal(code, 7);
            assert.equal(signal, null);
            assert.deepEqual(readJson("/study/foreground-result.json"), { value: 42, runtime });
            resolve();
          } catch (error) {
            reject(error);
          }
          return false;
        },
      );
      child.on("error", reject);
    });
  },
  "signal-exit"() {
    const { spawnSync } = require("node:child_process");
    const result = spawnSync(process.execPath, childArgs("signal-exit"), { encoding: "utf8" });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(readJson("/study/exit-result.json"), { code: 7, signal: null, runtime });
  },
  async "readable-stream"() {
    const { Readable, Transform, Writable, pipeline } = load("readable-stream");
    const values = [];
    const run = (...streams) =>
      new Promise((resolve, reject) =>
        pipeline(...streams, (error) => (error ? reject(error) : resolve())),
      );
    await run(
      Readable.from([1, 2, 3]),
      new Transform({
        objectMode: true,
        highWaterMark: 1,
        transform(n, _, cb) {
          setImmediate(() => cb(null, n * 2));
        },
      }),
      new Writable({
        objectMode: true,
        highWaterMark: 1,
        write(n, _, cb) {
          values.push(n);
          setImmediate(cb);
        },
      }),
    );
    assert.deepEqual(values, [2, 4, 6]);
    const expected = new Error("expected stream error");
    await assert.rejects(
      run(
        Readable.from([1]),
        new Writable({
          objectMode: true,
          write(_n, _encoding, cb) {
            cb(expected);
          },
        }),
      ),
      (error) => error === expected,
    );
  },
};
module.exports = async (name) => {
  assert.equal(typeof checks[name], "function");
  await checks[name]();
};
