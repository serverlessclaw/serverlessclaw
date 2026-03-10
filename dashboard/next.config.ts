import type { NextConfig } from "next";
import path from "path";

const nextConfig: any = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../'),
  transpilePackages: ['@claw/core'],
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
