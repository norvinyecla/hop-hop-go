import { defineConfig } from "vitest/config";

// The evals call the real model, so they need the keys in .env.local. Test workers inherit them.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Already in the environment, e.g. in CI.
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["evals/**/*.eval.ts"],
    // Every case calls the model, one at a time.
    testTimeout: 30 * 60_000,
  },
});
