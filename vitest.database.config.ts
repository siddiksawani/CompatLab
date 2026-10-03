import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/catalog/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
