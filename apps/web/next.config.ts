import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@misthos/shared"],
  poweredByHeader: false,
};

export default nextConfig;
