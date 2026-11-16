const assert = require("node:assert/strict");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
if (isMainThread) {
  module.exports = async () => {
    const worker = new Worker(__filename);
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("No worker echo after 8 seconds")), 8000);
        worker.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.on("message", (message) => {
          console.log("worker channel", message);
          if (message.ready) worker.postMessage(42);
          else {
            clearTimeout(timeout);
            try {
              assert.equal(message.echo, 42);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        });
      });
    } finally {
      await worker.terminate();
    }
  };
} else {
  const webGlobals = typeof self === "object" && typeof addEventListener === "function";
  if (webGlobals)
    addEventListener("message", (event) => parentPort.postMessage({ echo: event.data }));
  else parentPort.on("message", (value) => parentPort.postMessage({ echo: value }));
  parentPort.postMessage({ ready: true, webGlobals });
}
