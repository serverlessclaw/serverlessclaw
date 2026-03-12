import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.open-next/**'],
    alias: {
      '@': path.resolve(__dirname, './dashboard/src'),
      '@claw/core': path.resolve(__dirname, './core'),
    },
  },
});
