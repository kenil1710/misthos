import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// The test signs a session cookie with SESSION_SECRET from the root .env (never printed).
loadEnvConfig(path.resolve(__dirname, "../.."));

const PORT = 3100;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable";

export const E2E = { baseURL: `http://localhost:${PORT}`, dbUrl: DB_URL };

/**
 * Browser e2e against a throwaway in-memory database (e2e/db-server.mts) and a production build on :3100.
 * Run: pnpm --filter @misthos/web e2e
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: E2E.baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "tsx e2e/db-server.mts",
      port: 54329,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // A production build by default: realistic, and no on-demand compiles stalling clicks. E2E_DEV=1 uses next dev.
      command: process.env.E2E_DEV
        ? `next dev -p ${PORT}`
        : `next build && next start -p ${PORT}`,
      url: `${E2E.baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 420_000,
      env: {
        DATABASE_URL: DB_URL,
        DB_POOL_MAX: "1",
        NEXT_PUBLIC_APP_URL: E2E.baseURL,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
