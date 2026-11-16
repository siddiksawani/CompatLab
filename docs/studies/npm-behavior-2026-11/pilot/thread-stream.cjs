const assert = require("node:assert/strict");
const { once } = require("node:events");
const { readFile } = require("node:fs/promises");
const ThreadStream = require("/study/node_modules/thread-stream");

async function check() {
  const path = "/tmp/thread-stream-result";
  const stream = new ThreadStream({ filename: "/pilot/thread-sink.cjs", workerData: { path } });
  const closed = once(stream, "close");
  stream.write("CompatLab worker output\n");
  stream.end();
  await closed;
  assert.equal(await readFile(path, "utf8"), "CompatLab worker output\n");
}

module.exports = check;
