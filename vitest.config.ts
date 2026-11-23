import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    globalSetup: ["tests/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/adapters/**"],
      thresholds: { lines: 80, statements: 80, functions: 80 },
    },
  },
});
