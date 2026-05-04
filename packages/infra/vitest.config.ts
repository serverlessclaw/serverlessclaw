import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the infra package.
 * Infrastructure-as-code (SST/Pulumi) is validated through deployment
 * verification and E2E tests, not unit test coverage.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.sst/**'],
    coverage: {
      provider: 'v8',
      include: ['**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/node_modules/**', '**/.sst/**'],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
