import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { types } from "node:util";

const input = JSON.parse(readFileSync(new URL("./input.json", import.meta.url), "utf8"));
const write = writeFileSync,
  rename = renameSync,
  stringify = JSON.stringify;
const own = Object.getOwnPropertyDescriptor,
  nativeError = types.isNativeError,
  now = performance.now.bind(performance);
const checkpoint = {
  schemaVersion: 2,
  probeId: input.probeId,
  mode: "esm",
  group: "root",
  completed: false,
  activeIndex: 0,
  observations: [],
};
function save() {
  write("/output/checkpoint.next", stringify(checkpoint));
  rename("/output/checkpoint.next", "/output/checkpoint.json");
}
save();
const started = now();
let observation;
try {
  const probe = await import(new URL(`./source/${input.assertion.entry}`, import.meta.url));
  if (typeof probe.default !== "function")
    throw new TypeError("An assertion must export a default function.");
  await probe.default(Object.freeze({ packageName: input.entries[0] }));
  observation = {
    index: 0,
    outcome: "pass",
    resolvedTo: null,
    durationMs: now() - started,
    valueType: "undefined",
  };
} catch (error) {
  const descriptor = nativeError(error) ? own(error, "message") : null;
  observation = {
    index: 0,
    outcome: "fail",
    resolvedTo: null,
    durationMs: now() - started,
    error: {
      name: "AssertionError",
      message:
        typeof descriptor?.value === "string"
          ? descriptor.value.slice(0, 2048)
          : "The assertion threw a value.",
      code: null,
    },
  };
}
checkpoint.observations.push(observation);
checkpoint.activeIndex = null;
checkpoint.completed = true;
save();
