const { writeFileSync } = require("node:fs");
module.exports = async (name) => {
  writeFileSync("/study/loading-target.mjs", `await import(${JSON.stringify(name)});`);
  await import("file:///study/loading-target.mjs");
};
