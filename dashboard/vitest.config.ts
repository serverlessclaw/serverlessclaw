import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../vitest.config.ts';
import path from 'node:path';

export default mergeConfig(rootConfig, defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
  },
}));
