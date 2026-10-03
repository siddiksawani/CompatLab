import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { types } from "node:util";

const write = writeFileSync;
const rename = renameSync;
const stringify = JSON.stringify;
const own = Object.getOwnPropertyDescriptor;
const prototypeOf = Object.getPrototypeOf;
const errorNames = [
  Error,
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  EvalError,
  URIError,
  AggregateError,
].map((type) => [type.prototype, type.name]);
const nativeError = types.isNativeError;
const now = performance.now.bind(performance);
const require = createRequire(import.meta.url);
const resolveImport = import.meta.resolve?.bind(import.meta);
const resolveRequire = require.resolve.bind(require);
const input = JSON.parse(readFileSync(new URL("./input.json", import.meta.url), "utf8"));
const checkpoint = {
  schemaVersion: 2,
  probeId: input.probeId,
  mode: input.mode,
  group: input.group,
  completed: false,
  activeIndex: null,
  observations: [],
};

function save() {
  write("/output/checkpoint.next", stringify(checkpoint));
  rename("/output/checkpoint.next", "/output/checkpoint.json");
}
function errorField(error, field, fallback, length) {
  const descriptor = own(error, field);
  return typeof descriptor?.value === "string" ? descriptor.value.slice(0, length) : fallback;
}
function describeError(error) {
  if (!nativeError(error))
    return {
      name: "ThrownValue",
      message: "The module threw a non-native error value.",
      code: null,
    };
  return {
    name: errorField(
      error,
      "name",
      errorNames.find(([prototype]) => prototype === prototypeOf(error))?.[1] ?? "Error",
      128,
    ),
    message: errorField(error, "message", "", 2048),
    code: errorField(error, "code", null, 128),
  };
}
for (let index = input.startIndex; index < input.entries.length; index++) {
  checkpoint.activeIndex = index;
  save();
  const started = now();
  let resolvedTo = null;
  try {
    const resolved =
      input.mode === "esm"
        ? resolveImport?.(input.entries[index])
        : resolveRequire(input.entries[index]);
    if (typeof resolved === "string") resolvedTo = resolved.slice(0, 4096);
  } catch {}
  let observation;
  try {
    const value =
      input.mode === "esm" ? await import(input.entries[index]) : require(input.entries[index]);
    observation = {
      index,
      outcome: "pass",
      valueType: typeof value,
      resolvedTo,
      durationMs: now() - started,
    };
  } catch (error) {
    observation = {
      index,
      outcome: "fail",
      resolvedTo,
      error: describeError(error),
      durationMs: now() - started,
    };
  }
  checkpoint.observations.push(observation);
  checkpoint.activeIndex = null;
  save();
}
checkpoint.completed = true;
save();
