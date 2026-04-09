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
  });

  test('can click a trace to see details', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    // Look for clickable trace items
    const traceItem = page.locator('a[href*="/trace/"], [data-trace-id], tr, li').first();
    await expect(traceItem).toBeVisible({ timeout: 15000 });
    await traceItem.click();
    // Should navigate to trace detail or show detail view
    await page.waitForLoadState('networkidle');
  });

  test('navigation from sidebar to traces works', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/trace"]');
    await expect(page).toHaveURL('/trace');
  });
});
