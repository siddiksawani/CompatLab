import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pass = ["pass", "pass"];
const fail = ["fail", "fail"];
const none = ["not_applicable", "not_applicable"];
const cjs = (source, manifest = {}, files = {}) => ({
  manifest: { main: "index.cjs", ...manifest },
  files: { "index.cjs": source, ...files },
});
const esm = (source, manifest = {}) => ({
  manifest: { type: "module", exports: "./index.mjs", ...manifest },
  files: { "index.mjs": source },
});
export const corpus = [
  ["cjs", pass, cjs("module.exports = { value: 1 };")],
  ["esm", pass, esm("export const value = 1;")],
  [
    "tla",
    ["pass", "fail"],
    esm("await new Promise(resolve => setTimeout(resolve, 1)); export const value = 1;"),
  ],
  [
    "dual",
    pass,
    cjs(
      "module.exports = 1;",
      { exports: { import: "./index.mjs", require: "./index.cjs" } },
      { "index.mjs": "export default 1;" },
    ),
  ],
  [
    "default-first",
    pass,
    cjs(
      "module.exports = 1;",
      { exports: { default: "./index.cjs", import: "./wrong.mjs" } },
      { "wrong.mjs": "throw new Error('wrong condition');" },
    ),
  ],
  [
    "nested",
    pass,
    cjs("module.exports = 1;", {
      exports: { node: { import: "./index.cjs", require: "./index.cjs" } },
    }),
  ],
  ["node-condition", pass, cjs("module.exports = 1;", { exports: { node: "./index.cjs" } })],
  [
    "runtime-condition",
    pass,
    cjs("module.exports = 1;", {
      exports: { bun: "./index.cjs", deno: "./index.cjs", node: "./index.cjs" },
    }),
  ],
  [
    "subpaths-only",
    none,
    cjs("module.exports = 1;", { exports: { "./a": "./index.cjs", "./b": "./index.cjs" } }),
  ],
  ["pattern-only", none, cjs("module.exports = 1;", { exports: { "./*": "./*.cjs" } })],
  [
    "blocked-root",
    none,
    cjs("module.exports = 1;", { exports: { ".": null, "./a": "./index.cjs" } }),
  ],
  ["asset-root", none, { manifest: { exports: "./data.json" }, files: { "data.json": "{}" } }],
  [
    "types-only",
    none,
    {
      manifest: { exports: "./index.d.ts" },
      files: { "index.d.ts": "export declare const value: number;" },
    },
  ],
  ["invalid-target", fail, cjs("module.exports = 1;", { exports: "../outside.cjs" })],
  ["parent-segment", fail, cjs("module.exports = 1;", { exports: "./../outside.cjs" })],
  ["missing-file", fail, { manifest: { main: "missing.cjs" }, files: {} }],
  ["syntax-error", fail, cjs("module.exports = ;")],
  [
    "throw-error",
    fail,
    cjs("throw Object.assign(new Error('fixture failure'), { code: 'FIXTURE_ERROR' });"),
  ],
  ["throw-string", fail, cjs("throw 'fixture failure';")],
  [
    "throw-proxy",
    fail,
    cjs(
      "throw new Proxy({}, { get() { throw new Error('error getter'); }, getOwnPropertyDescriptor() { throw new Error('error descriptor'); } });",
    ),
  ],
  [
    "getter-export",
    pass,
    esm(
      "export default Object.defineProperty({}, 'value', { get() { throw new Error('export getter invoked'); } });",
    ),
  ],
  [
    "proxy-export",
    pass,
    esm(
      "export default new Proxy({}, { ownKeys() { throw new Error('export inspected'); }, get() { throw new Error('export accessed'); } });",
    ),
  ],
  [
    "function-export",
    pass,
    cjs("module.exports = () => { throw new Error('function invoked'); };"),
  ],
  ["primitive-export", pass, cjs("module.exports = 42;")],
  [
    "builtin-import",
    pass,
    cjs(
      "module.exports = require('node:crypto').createHash('sha256').update('fixture').digest('hex');",
    ),
  ],
  [
    "local-dependency",
    pass,
    cjs("module.exports = require('./helper.cjs');", {}, { "helper.cjs": "module.exports = 42;" }),
  ],
  [
    "nested-dependency",
    pass,
    cjs(
      "module.exports = require('fixture-helper');",
      { dependencies: { "fixture-helper": "1.0.0" } },
      {
        "node_modules/fixture-helper/package.json":
          '{"name":"fixture-helper","version":"1.0.0","main":"index.cjs"}',
        "node_modules/fixture-helper/index.cjs": "module.exports = 42;",
      },
    ),
  ],
  [
    "alias-dependency",
    pass,
    cjs(
      "module.exports = require('renamed');",
      { dependencies: { renamed: "npm:fixture-helper@1.0.0" } },
      {
        "node_modules/renamed/package.json":
          '{"name":"fixture-helper","version":"1.0.0","main":"index.cjs"}',
        "node_modules/renamed/index.cjs": "module.exports = 42;",
      },
    ),
  ],
  [
    "optional-present",
    pass,
    cjs(
      "module.exports = require('optional');",
      { optionalDependencies: { optional: "1.0.0" } },
      {
        "node_modules/optional/package.json":
          '{"name":"optional","version":"1.0.0","main":"index.cjs"}',
        "node_modules/optional/index.cjs": "module.exports = 42;",
      },
    ),
  ],
  [
    "optional-absent",
    pass,
    cjs("try { require('compatlab-missing-optional'); } catch { module.exports = 42; }", {
      optionalDependencies: { "compatlab-missing-optional": "1.0.0" },
    }),
  ],
  [
    "missing-peer",
    fail,
    cjs("module.exports = require('compatlab-missing-peer');", {
      peerDependencies: { "compatlab-missing-peer": "1.0.0" },
    }),
  ],
  [
    "bundled",
    pass,
    cjs(
      "module.exports = require('bundled');",
      { bundledDependencies: ["bundled"] },
      {
        "node_modules/bundled/package.json":
          '{"name":"bundled","version":"1.0.0","main":"index.cjs"}',
        "node_modules/bundled/index.cjs": "module.exports = 42;",
      },
    ),
  ],
  [
    "wasm-embedded",
    pass,
    cjs("module.exports = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));"),
  ],
  [
    "wasm-file",
    pass,
    cjs(
      "module.exports = new WebAssembly.Module(require('node:fs').readFileSync(require('node:path').join(__dirname, 'empty.wasm')));",
      {},
      { "empty.wasm": Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) },
    ),
  ],
  ["native-shipped", pass, cjs("module.exports = require('./addon.node');")],
  [
    "script-required",
    fail,
    cjs(
      "module.exports = require('./generated.cjs');",
      { scripts: { install: "node generate.cjs" } },
      { "generate.cjs": "require('node:fs').writeFileSync('generated.cjs', 'module.exports=42');" },
    ),
  ],
  [
    "native-invalid",
    fail,
    cjs("module.exports = require('./addon.node');", {}, { "addon.node": "invalid ELF" }),
  ],
  ["browser-global", fail, cjs("module.exports = window.location.href;")],
  [
    "dirname",
    pass,
    cjs(
      "if (!require('node:fs').existsSync(require('node:path').join(__dirname, 'package.json'))) throw new Error('dirname');",
    ),
  ],
  [
    "import-meta",
    pass,
    esm(
      "if (!import.meta.url.startsWith('file:')) throw new Error('import meta'); export const value = 1;",
    ),
  ],
];

export const liveCorpus = [
  ["is-number", "7.0.0"],
  ["nanoid", "3.3.8"],
  ["kleur", "4.1.5"],
  ["picocolors", "1.1.1"],
  ["ms", "2.1.3"],
  ["escape-string-regexp", "4.0.0"],
  ["yocto-queue", "1.1.1"],
  ["camelcase", "8.0.0"],
  ["eventemitter3", "5.0.1"],
  ["lodash.debounce", "4.0.8"],
];
export const protocolCases = [
  ["exit-code", null, cjs("process.exit(125);")],
  [
    "mixed",
    null,
    cjs(
      "module.exports = 1;",
      { exports: { "./a": "./index.cjs", "./bad": "./bad.cjs", "./b": "./index.cjs" } },
      { "bad.cjs": "throw new Error('expected');" },
    ),
  ],
  ["crash", null, batch("process.exit(42);")],
  ["timeout", null, batch("while (true) {}")],
  [
    "restart-limit",
    null,
    cjs("process.exit(42);", {
      exports: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`./${index}`, "./index.cjs"]),
      ),
    }),
  ],
  [
    "shared-state",
    null,
    cjs(
      "globalThis.fixtureCounter = 1;",
      { exports: { "./a": "./index.cjs", "./b": "./b.cjs" } },
      { "b.cjs": "if(globalThis.fixtureCounter !== 1) throw new Error('batch state lost');" },
    ),
  ],
  [
    "fake-stdout",
    null,
    cjs("console.log(JSON.stringify({completed:true,outcome:'pass'})); process.exit(0);"),
  ],
  [
    "malformed",
    null,
    cjs("require('node:fs').writeFileSync('/output/checkpoint.json','{'); process.exit(0);"),
  ],
  ["bounded-error", null, cjs("throw new Error('x'.repeat(2 * 1024 * 1024));")],
  [
    "error-getter",
    null,
    cjs(
      "const e = new Error('expected'); Object.defineProperty(e, 'code', {get() {throw new Error('getter invoked');}}); throw e;",
    ),
  ],
  [
    "work-cap",
    null,
    cjs("module.exports = 1;", {
      exports: Object.fromEntries(
        Array.from({ length: 600 }, (_, index) => [`./${index}`, "./index.cjs"]),
      ),
    }),
  ],
];
function batch(source) {
  return cjs(
    "module.exports = 1;",
    { exports: { "./a": "./index.cjs", "./bad": "./bad.cjs", "./b": "./index.cjs" } },
    { "bad.cjs": source },
  );
}

export async function createCorpus(workspace) {
  await mkdir(join(workspace, ".compatlab"));
  await writeFile(join(workspace, "package.json"), '{"name":"compatlab-consumer","private":true}');
  for (const [id, , fixture] of [...corpus, ...protocolCases]) {
    const path = join(workspace, "node_modules", `compatlab-fixture-${id}`);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({ name: `compatlab-fixture-${id}`, version: "1.0.0", ...fixture.manifest }),
    );
    for (const [file, content] of Object.entries(fixture.files)) {
      const destination = join(path, file);
      await mkdir(join(destination, ".."), { recursive: true });
      await writeFile(destination, content);
    }
  }
}
