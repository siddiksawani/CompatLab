const assert = require("node:assert/strict");
const esbuild = require("/study/node_modules/esbuild");

const source = "const answer: number = 6 * 7;";
const result = esbuild.transformSync(source, { loader: "ts" });
assert.equal(result.warnings.length, 0);
assert.equal(new Function(`${result.code}\nreturn answer;`)(), 42);
