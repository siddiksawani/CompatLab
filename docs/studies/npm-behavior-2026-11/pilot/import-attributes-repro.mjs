import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
assert.ok(["direct", "hook", "package"].includes(mode));
const cases = [];
const events = [];
let fresh;
if (mode === "package") {
  const { default: createImportFresh } = await import("/study/import-fresh-suite/index.js");
  fresh = createImportFresh(import.meta.url);
}
if (mode === "hook") {
  registerHooks({
    resolve(specifier, context, next) {
      events.push({ phase: "resolve", specifier, attributes: { ...context.importAttributes } });
      if (specifier.startsWith("triage:")) {
        return { url: specifier, format: "module", shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      events.push({ phase: "load", url, attributes: { ...context.importAttributes } });
      if (url.startsWith("triage:")) {
        const error = new TypeError("load-hook sentinel");
        error.code = "TRIAGE_ATTRIBUTE_REJECTED";
        if (Object.keys(context.importAttributes ?? {}).length) throw error;
        return {
          format: "module",
          source: "globalThis.triageExecuted++; export default 1;",
          shortCircuit: true,
        };
      }
      return next(url, context);
    },
  });
}
for (const [name, attributes] of Object.entries({
  empty: {},
  json: { type: "json" },
  commonjs: { type: "commonjs" },
  unknown: { unknown: "value" },
})) {
  globalThis.triageExecuted = 0;
  const start = events.length;
  const file = `/study/attribute-${name}.cjs`;
  writeFileSync(file, "globalThis.triageExecuted++; module.exports = {value: 1};");
  const specifier = mode === "hook" ? `triage:${name}` : pathToFileURL(file).href;
  const row = { name, attributes };
  try {
    const value =
      mode === "package"
        ? await fresh(specifier, { importAttributes: attributes })
        : await import(specifier, { with: attributes });
    row.loaded = true;
    row.value = value.default;
  } catch (error) {
    row.loaded = false;
    row.error = { name: error.name, code: error.code ?? null, message: error.message };
  }
  row.executed = globalThis.triageExecuted;
  row.events = events.slice(start);
  cases.push(row);
  writeFileSync("/results/suite.json", JSON.stringify({ mode, cases }));
}
assert.equal(cases.length, 4);
