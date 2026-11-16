const [tool, ...args] = process.argv.slice(2);

if (tool === "jest") {
  require("/study/node_modules/jest")
    .run(args)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
} else if (tool === "mocha") {
  require("/study/node_modules/mocha/lib/cli").main(args);
} else {
  throw new Error(`Unknown upstream suite runner: ${tool}`);
}
