import { defineConfig } from "vitest/config";

// PGlite (WASM Postgres) is CPU-heavy; leave headroom when the whole monorepo tests in parallel.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
