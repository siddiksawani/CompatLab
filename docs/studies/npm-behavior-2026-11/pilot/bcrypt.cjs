const assert = require("node:assert/strict");
const bcrypt = require("/study/node_modules/bcrypt");

const value = "CompatLab test input";
const salt = "$2b$04$abcdefghijklmnopqrstuu";
const hash = bcrypt.hashSync(value, salt);
assert.equal(hash.length, 60);
assert.equal(bcrypt.compareSync(value, hash), true);
assert.equal(bcrypt.compareSync("different input", hash), false);
