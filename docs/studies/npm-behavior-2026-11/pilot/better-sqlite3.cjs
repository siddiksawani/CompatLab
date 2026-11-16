const assert = require("node:assert/strict");
const Database = require("/study/node_modules/better-sqlite3");
assert.equal(typeof Database, "function");
console.log("The package root returned the Database constructor.");

const database = new Database(":memory:");
try {
  database.exec("CREATE TABLE entries (score INTEGER)");
  database.prepare("INSERT INTO entries VALUES (?)").run(42);
  assert.equal(database.prepare("SELECT score FROM entries").pluck().get(), 42);
  console.log("Read back score 42.");
} finally {
  database.close();
}
