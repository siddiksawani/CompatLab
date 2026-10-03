import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
await import("is-number");
assert.equal(typeof require("is-number"), "function");
writeFileSync("/output/result.json", JSON.stringify({ loaded: true }));
