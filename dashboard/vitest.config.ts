import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../vitest.config.ts';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default mergeConfig(rootConfig as any, defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any);
