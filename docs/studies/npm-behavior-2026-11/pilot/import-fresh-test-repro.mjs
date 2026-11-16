import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const mode = process.env.REPRO_MODE;
const events = [];
function record(event) {
  events.push(event);
  writeFileSync("/results/suite.json", JSON.stringify({ events }));
}
if (mode === "package") {
  const { default: createImportFresh } = await import("/study/import-fresh-suite/index.js");
  const fresh = createImportFresh("file:///study/import-fresh-suite/tests/test.js");
  test("first import", async () => {
    const result = await fresh("./fixtures/increment.js");
    assert.equal(result.default(), 1);
    record("first passed");
  });
  test("nested import", async () => {
    record("nested started");
    const result = await fresh("./fixtures/top-level-await.js");
    assert.equal(result.default(), 1);
    record("nested passed");
  });
} else {
  assert.ok(mode === "plain" || mode === "hook");
  globalThis.contextStorage = new AsyncLocalStorage();
  writeFileSync(
    "/study/context-child.mjs",
    "export const context = globalThis.contextStorage.getStore();",
  );
  if (mode === "hook")
    registerHooks({
      resolve(specifier, context, next) {
        return next(specifier, context);
      },
    });
  for (const label of ["first", "second"]) {
    test(label, async () => {
      await globalThis.contextStorage.run(label, async () => {
        const result = await import(`/study/context-child.mjs?${label}`);
        record({ label, observed: result.context ?? null });
        assert.equal(result.context, label);
      });
    });
  }
}
