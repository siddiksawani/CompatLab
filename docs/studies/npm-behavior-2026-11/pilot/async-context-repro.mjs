import assert from "node:assert/strict";
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import nativeTest from "node:test";
import { setImmediate } from "node:timers/promises";

const storage = new AsyncLocalStorage();
globalThis.compatlabContext = storage;
const test =
  process.env.BIND_CONTEXT === "1"
    ? (name, fn) => nativeTest(name, AsyncResource.bind(fn))
    : nativeTest;

test("first context finishes", async () => {
  await storage.run("first", async () => {
    if (process.env.SKIP_IMPORT !== "1") {
      const child = await import("./async-context-child.mjs?first");
      assert.equal(child.observed, "first");
    }
    await setImmediate();
    assert.equal(storage.getStore(), "first");
  });
  assert.equal(storage.getStore(), undefined);
});
test("second context starts empty", () => {
  assert.equal(storage.getStore(), undefined);
  if (process.env.FAIL_CONTROL === "1") assert.fail("intentional assertion control");
});
