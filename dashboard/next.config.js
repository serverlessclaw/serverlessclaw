const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../'),
  transpilePackages: ['@claw/core'],
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: path.join(__dirname, '../'),
    rules: {
      '*.md': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      use: 'raw-loader',
    });
    return config;
  },
};

module.exports = nextConfig;
