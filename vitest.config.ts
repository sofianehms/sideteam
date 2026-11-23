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
    },
  },
});
