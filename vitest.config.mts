import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/index.ts", "lib/**/*.test.ts"],
      // docs/standards.md section 7: 90% line coverage for the core domain modules.
      thresholds: {
        "lib/ingest/**": { lines: 90 },
        "lib/feedback/**": { lines: 90 },
        "lib/health/**": { lines: 90 },
      },
    },
  },
});
