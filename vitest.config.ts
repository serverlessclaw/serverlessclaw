import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the project, providing unified test execution
 * for both core logic and dashboard components with 2026-grade aliases.
 */
export default defineConfig({
  assetsInclude: ['**/*.md'],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.open-next/**', 'e2e/**'],
    setupFiles: ['./dashboard/src/test-setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './dashboard/src'),
      '@claw/core': path.resolve(__dirname, './core'),
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
});
