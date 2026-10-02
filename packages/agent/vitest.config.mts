import { defineConfig } from "vitest/config";

// PGlite-backed pipeline tests are CPU-heavy; leave headroom when the monorepo tests in parallel.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
