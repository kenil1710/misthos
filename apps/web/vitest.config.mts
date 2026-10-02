import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  // PGlite-backed tests are CPU-heavy; leave headroom when the whole monorepo tests in parallel.
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
});
