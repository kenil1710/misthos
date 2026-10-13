import { loadEnvConfig } from "@next/env";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import path from "node:path";
import { canonicalRedirects } from "./src/lib/canonical-host";

// Secrets live in the monorepo root .env (gitignored). On Vercel, env vars come from the project settings instead.
loadEnvConfig(
  path.resolve(__dirname, "../.."),
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@misthos/shared", "@misthos/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // The dev-only badge sat on top of the app's sidebar footer.
  devIndicators: false,
  // AVIF first: product screenshots compress far better than WebP, which matters for the mobile hero (LCP).
  images: { qualities: [70, 75], formats: ["image/avif", "image/webp"] },
  // Lets the e2e dev server run beside a normal `next dev` without sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // RainbowKit lists Base Account, which Misthos doesn't offer; its SDK (and the CDP server SDK behind it) stays out.
  turbopack: { resolveAlias: { "@base-org/account": "./src/lib/base-account-stub.ts" } },
  // The old vercel.app URL and www answer with a permanent redirect to https://misthos.world (path kept).
  async redirects() {
    return canonicalRedirects();
  },
  // Baseline security headers on every response. Framing is refused outright (clickjacking on owner actions); no
  // full CSP yet, only frame-ancestors. Permissions-Policy turns off device APIs the app never uses.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default createMDX()(nextConfig);
