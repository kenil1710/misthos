import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// The test signs a session cookie with SESSION_SECRET from the root .env (never printed).
loadEnvConfig(path.resolve(__dirname, "../.."));

const PORT = 3100;
// E2E_DB_PORT lets e2e run beside another throwaway stack (e.g. the screenshot showcase on 54329).
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 54329);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres?sslmode=disable`;

// A second server from the same build, with an Arc Mainnet agent configured (chain-free address, nothing is sent): the
// wizard offers Mainnet there. The main server has none, so it shows Mainnet as "Coming soon".
const MAINNET_PORT = 3101;
export const E2E = {
  baseURL: `http://localhost:${PORT}`,
  mainnetURL: `http://localhost:${MAINNET_PORT}`,
  dbUrl: DB_URL,
  /** The e2e mainnet agent (no key behind it; the injected wallet fakes the chain). */
  mainnetAgent: "0x00000000000000000000000000000000000a6e48",
};
const serverEnv = {
  DATABASE_URL: DB_URL,
  DB_POOL_MAX: "1",
  NEXT_DIST_DIR: ".next-e2e",
  // A fixed, chain-free agent address: the setup screen needs one to offer "Deploy vault", and e2e must not
  // depend on what the developer's .env holds. Nothing is ever sent to it (the injected wallet fakes the chain).
  CIRCLE_AGENT_WALLET_ADDRESS: "0x00000000000000000000000000000000000a6e47",
  // Never the developer's mainnet agent: the main server runs with Arc Mainnet off.
  CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: "",
};

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
      port: DB_PORT,
      reuseExistingServer: !!process.env.E2E_REUSE,
      stdout: "pipe",
    },
    {
      // A production build by default: realistic, and no on-demand compiles stalling clicks. E2E_DEV=1 uses next dev.
      command: process.env.E2E_DEV ? `next dev -p ${PORT}` : `next build && next start -p ${PORT}`,
      url: `${E2E.baseURL}/api/health`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 420_000,
      env: { ...serverEnv, NEXT_PUBLIC_APP_URL: E2E.baseURL },
    },
    ...(process.env.E2E_DEV
      ? []
      : [
          {
            // Starts once the main server is up (so the build is fresh), from the same build.
            command: `sh -c 'until curl -sf ${E2E.baseURL}/api/health >/dev/null; do sleep 2; done; next start -p ${MAINNET_PORT}'`,
            url: `${E2E.mainnetURL}/api/health`,
            reuseExistingServer: !!process.env.E2E_REUSE,
            timeout: 480_000,
            env: {
              ...serverEnv,
              NEXT_PUBLIC_APP_URL: E2E.mainnetURL,
              CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: E2E.mainnetAgent,
            },
          },
        ]),
  ],
});
