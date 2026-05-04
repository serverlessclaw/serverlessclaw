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
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.open-next/**', 'e2e/**'],
    // Increase default test timeout to accommodate larger import/setup times
    // when running the full monorepo test suite on CI or local machines.
    testTimeout: 20000,
    setupFiles: [path.resolve(__dirname, './packages/core/tests/setup.ts')],
    alias: {
      '@': path.resolve(__dirname, './apps/dashboard/src'),
      '@claw/core': path.resolve(__dirname, './packages/core'),
    },
    // Ensure TSX files are transformed for the web environment (jsdom)
    browser: {
      enabled: false, // Don't use real browser, but help with environment detection
    },
    server: {
      deps: {
        inline: [/apps\/dashboard/],
      },
    },
    coverage: {
      provider: 'v8',
      include: [
        'packages/core/**/*.ts',
        'packages/infra/**/*.ts',
        'apps/dashboard/src/**/*.{ts,tsx}',
      ],
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
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  plugins: [react()],
});
