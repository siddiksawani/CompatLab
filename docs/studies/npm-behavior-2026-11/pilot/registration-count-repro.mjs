import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const file = "/study/import-fresh-suite/index.js";
const source = readFileSync(file, "utf8");
const call = "nodeModule.registerHooks({";
assert.equal(source.split(call).length, 2);
writeFileSync(
  file,
  source.replace(
    call,
    `globalThis.triageRegistrations = (globalThis.triageRegistrations ?? 0) + 1; ${call}`,
  ),
);
const { default: createImportFresh } = await import(file);
const fresh = createImportFresh("file:///study/import-fresh-suite/tests/test.js");
const values = [];
for (let i = 0; i < 3; i++) {
  const value = await fresh("./fixtures/top-level-await.js");
  values.push(value.default());
}
const result = { registrations: globalThis.triageRegistrations, values };
writeFileSync("/results/suite.json", JSON.stringify(result));
assert.deepEqual(result, { registrations: 1, values: [1, 1, 1] });
