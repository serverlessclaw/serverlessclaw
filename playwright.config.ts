import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 3000,
  },
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  use: {
    actionTimeout: 3000,
    baseURL: process.env.BASE_URL || 'http://localhost:7777',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined // skip local server when testing a deployed URL
    : {
        command: 'pnpm --filter @serverlessclaw/dashboard dev',
        port: 7777,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, timeout: 120_000 },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
