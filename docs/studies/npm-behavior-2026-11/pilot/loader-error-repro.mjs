import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const expected = new TypeError("deliberate loader rejection");
expected.code = "TRIAGE_ATTRIBUTE_REJECTED";
registerHooks({
  resolve(specifier, context, next) {
    return specifier === "triage:error"
      ? { url: specifier, format: "module", shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    if (url === "triage:error") throw expected;
    return next(url, context);
  },
});
let observed;
try {
  await import("triage:error");
} catch (error) {
  observed = error;
}
writeFileSync(
  "/results/suite.json",
  JSON.stringify({
    rejected: observed !== undefined,
    sameError: observed === expected,
    code: observed?.code ?? null,
    name: observed?.name ?? null,
    message: observed?.message ?? null,
  }),
);
assert.equal(observed?.code, expected.code);
