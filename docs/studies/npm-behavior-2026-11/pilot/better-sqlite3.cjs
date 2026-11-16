const assert = require("node:assert/strict");
const Database = require("/study/node_modules/better-sqlite3");

const database = new Database(":memory:");
try {
  database.exec("CREATE TABLE entries (score INTEGER)");
  database.prepare("INSERT INTO entries VALUES (?)").run(42);
  assert.equal(database.prepare("SELECT score FROM entries").pluck().get(), 42);
} finally {
  database.close();
}
