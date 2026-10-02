import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// Secrets live in the monorepo root .env (gitignored). On Vercel, env vars come from the project settings instead.
loadEnvConfig(path.resolve(__dirname, "../.."), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  transpilePackages: ["@misthos/shared", "@misthos/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Lets the e2e dev server run beside a normal `next dev` without sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
