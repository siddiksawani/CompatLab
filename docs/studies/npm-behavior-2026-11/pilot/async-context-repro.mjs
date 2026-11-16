import assert from "node:assert/strict";
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import nativeTest from "node:test";
import { setImmediate } from "node:timers/promises";

const storage = new AsyncLocalStorage();
const test =
  process.env.BIND_CONTEXT === "1"
    ? (name, fn) => nativeTest(name, AsyncResource.bind(fn))
    : nativeTest;

test("first context finishes", async () => {
  await storage.run("first", async () => {
    await setImmediate();
    assert.equal(storage.getStore(), "first");
  });
  assert.equal(storage.getStore(), undefined);
});
test("second context starts empty", () => {
  assert.equal(storage.getStore(), undefined);
  if (process.env.FAIL_CONTROL === "1") assert.fail("intentional assertion control");
});
