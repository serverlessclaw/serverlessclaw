import { test as setup } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');

  // Fill in the password (uses env var or fallback for local dev)
  const password = process.env.DASHBOARD_PASSWORD || 'test-password';
  console.log(
    `[E2E:Auth] Authenticating with password from ${process.env.DASHBOARD_PASSWORD ? 'env' : 'fallback'}`
  );

  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  // Wait for redirect to home page with generous timeout for dev mode warmup
  await page.waitForURL('/', { timeout: 60000 });

  // Save authentication state
  await page.context().storageState({ path: authFile });
});
