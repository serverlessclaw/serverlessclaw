import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');

  // Fill in the password (uses env var or fallback for local dev)
  const password = process.env.DASHBOARD_PASSWORD || 'test-password';
  console.log(
    `[E2E:Auth] Authenticating with password from ${process.env.DASHBOARD_PASSWORD ? 'env' : 'fallback'}`
  );

  // Wait for input to be ready
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 15000 });
  await passwordInput.fill(password);

  // Click and wait for navigation
  await page.click('button[type="submit"]');

  // Diagnostic wait: Check if we moved to the dashboard
  try {
    // We expect to be redirected to the root
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', {
      timeout: 30000,
    });
  } catch {
    console.error(`[E2E:Auth] Navigation failed. Current URL: ${page.url()}`);

    // Check for explicit error messages on the page
    const errorMsg = page.locator('text=/Invalid|Error|Failed|Incorrect/i');
    if (await errorMsg.isVisible()) {
      const text = await errorMsg.innerText();
      throw new Error(`[E2E:Auth] Login failed with message: "${text}"`);
    }

    throw new Error(`[E2E:Auth] Timeout waiting for dashboard redirect. Stuck at ${page.url()}`);
  }

  // Ensure sidebar or main content is visible
  await expect(page.locator('nav').first()).toBeVisible({ timeout: 15000 });

  // Save authentication state
  await page.context().storageState({ path: authFile });
  console.log('[E2E:Auth] Authentication state saved successfully');
});
