import assert from "node:assert/strict";
import fs from "node:fs";
import Module, * as namespace from "node:module";

const original = Module.registerHooks;
const replacement = (...args) => original(...args);
const result = { before: namespace.registerHooks === original };
const skipPatch = process.env.SKIP_PATCH === "1";
try {
  if (!skipPatch) Module.registerHooks = replacement;
  namespace.syncBuiltinESMExports();
  result.defaultChanged = Module.registerHooks === replacement;
  result.namedChanged = namespace.registerHooks === replacement;
  fs.writeFileSync("/results/suite.json", JSON.stringify(result));
  assert.equal(result.namedChanged, !skipPatch);
  assert.notEqual(process.env.FAIL_CONTROL, "1");
} finally {
  Module.registerHooks = original;
  namespace.syncBuiltinESMExports();
}
