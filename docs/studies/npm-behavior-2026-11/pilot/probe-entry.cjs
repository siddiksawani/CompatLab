const { writeFileSync } = require("node:fs");
const [file, ...args] = process.argv.slice(2);
process.exitCode = 1;
Promise.resolve()
  .then(async () => {
    const probe = require(file);
    if (typeof probe === "function") await probe(...args);
    writeFileSync(
      "/results/completion.json",
      JSON.stringify({ schemaVersion: 1, file, args, completed: true }),
    );
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
