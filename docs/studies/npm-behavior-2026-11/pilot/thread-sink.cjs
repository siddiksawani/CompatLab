const { once } = require("node:events");
const { createWriteStream } = require("node:fs");

module.exports = async ({ path }) => {
  const output = createWriteStream(path);
  await once(output, "open");
  return output;
};
