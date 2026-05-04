import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config.ts';
import path from 'node:path';

export default mergeConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootConfig as any,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
);
