import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
