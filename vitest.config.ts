import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

/**
 * Vitest configuration for the project, providing unified test execution
 * for both core logic and dashboard components with 2026-grade aliases.
 */
export default defineConfig({
  assetsInclude: ['**/*.md'],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.open-next/**', 'e2e/**'],
    setupFiles: ['./dashboard/src/test-setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './dashboard/src'),
      '@claw/core': path.resolve(__dirname, './core'),
    },
    // Ensure TSX files are transformed for the web environment (jsdom)
    browser: {
      enabled: false, // Don't use real browser, but help with environment detection
    },
    server: {
      deps: {
        inline: [/dashboard/],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts', 'infra/**/*.ts', 'dashboard/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/.sst/**',
        '**/.next/**',
        '**/.open-next/**',
        'e2e/**',
      ],
      thresholds: {
        lines: 55,
        functions: 45,
        branches: 45,
        statements: 55,
      },
    },
  },
  plugins: [react()],
});
