import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createRuntimeFixtures(workspace) {
  await mkdir(join(workspace, ".compatlab"));
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ name: "compatlab-consumer", private: true }),
  );
  await writeFile(join(workspace, "typed.ts"), "const value: number = 42; export default value;\n");
  const fixtures = {
    cjs: { manifest: { main: "index.cjs" }, files: { "index.cjs": 'exports.value = "cjs";' } },
    esm: {
      manifest: { type: "module", exports: "./index.mjs" },
      files: { "index.mjs": 'export const value = "esm";' },
    },
    tla: {
      manifest: { type: "module", exports: { import: "./index.mjs", require: "./require.mjs" } },
      files: {
        "index.mjs":
          'await new Promise(resolve => setTimeout(resolve, 1)); export const value = "tla";',
        "require.mjs":
          'await new Promise(resolve => setTimeout(resolve, 1)); export const value = "tla";',
      },
    },
    conditions: {
      manifest: { exports: { bun: "./bun.cjs", deno: "./deno.cjs", node: "./node.cjs" } },
      files: Object.fromEntries(
        ["node", "bun", "deno"].map((kind) => [`${kind}.cjs`, `exports.value = "${kind}";`]),
      ),
    },
    order: {
      manifest: { exports: { default: "./first.cjs", import: "./wrong.mjs" } },
      files: {
        "first.cjs": 'exports.value = "first";',
        "wrong.mjs": 'throw new Error("Condition order changed.");',
      },
    },
    native: {
      manifest: { main: "index.cjs" },
      files: { "index.cjs": 'module.exports = require("./addon.node");' },
    },
    prerequisite: {
      manifest: { main: "index.cjs", scripts: { install: "node-gyp rebuild" } },
      files: { "index.cjs": 'module.exports = require("./missing.node");', "binding.gyp": "{}" },
    },
  };
  for (const condition of ["node-addons", "module-sync"])
    fixtures[condition] = {
      manifest: { exports: { [condition]: "./enabled.cjs", default: "./default.cjs" } },
      files: {
        "enabled.cjs": `exports.value = "${condition}";`,
        "default.cjs": 'exports.value = "default";',
      },
    };
  for (const [id, fixture] of Object.entries(fixtures)) {
    const directory = join(workspace, "node_modules", `compatlab-fixture-${id}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: `compatlab-fixture-${id}`, version: "1.0.0", ...fixture.manifest }),
    );
    for (const [path, source] of Object.entries(fixture.files))
      await writeFile(join(directory, path), `${source}\n`);
  }
}
