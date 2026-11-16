const { writeFileSync } = require("node:fs");
const runtime = process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node";
const mode = process.argv[2];
if (mode === "signal-exit") {
  const { onExit } = require("/study/node_modules/signal-exit");
  onExit((code, signal) =>
    writeFileSync("/study/exit-result.json", JSON.stringify({ code, signal, runtime })),
  );
} else if (mode === "foreground-child") {
  writeFileSync("/study/foreground-result.json", JSON.stringify({ value: 42, runtime }));
} else {
  console.log(JSON.stringify({ value: 42, runtime }));
}
if (mode === "signal-exit" || mode === "foreground-child" || mode === "fail") process.exit(7);
