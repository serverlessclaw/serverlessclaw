import { test, expect } from '@playwright/test';

test.describe('Traces', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders traces page', async ({ page }) => {
    await page.goto('/trace');
    await expect(page).toHaveURL('/trace');
  });

  test('displays trace list', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');
    // Should load without critical errors
    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.getByText(/Trace Intelligence|追踪情报/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('can click a trace to see details', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    const traceLinks = page.locator('a[href*="/trace/"]');
    const traceCount = await traceLinks.count();

    if (traceCount === 0) {
      await expect(
        page.getByText(/NO_TRACES_FOUND|未找到链路|No active mission logs detected/i)
      ).toBeVisible({
        timeout: 15000,
      });
      return;
    }

    await traceLinks.first().click();
    // Should navigate to trace detail or show detail view
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('trace-detail-container')).toBeVisible({ timeout: 20000 });
  });

  test('navigation from sidebar to traces works', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href="/trace"]').first().click();
    await expect(page).toHaveURL('/trace');
  });
});
