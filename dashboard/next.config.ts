import type { NextConfig } from "next";
import path from "path";

const nextConfig: any = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Setting turbopack config at the top level for monorepo root discovery
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
