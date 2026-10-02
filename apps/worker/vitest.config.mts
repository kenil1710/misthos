import { defineConfig } from "vitest/config";

// Queue tests run pg-boss on PGlite (WASM Postgres); leave headroom when the monorepo tests in parallel.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
