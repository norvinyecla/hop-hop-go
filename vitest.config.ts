import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve "@/..." imports the same way Next.js does.
  resolve: { tsconfigPaths: true },
});
