import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    turbopack: {
      root: path.resolve(__dirname, ".."),
    },
  },
};

export default nextConfig;
