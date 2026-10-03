import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,services}/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
