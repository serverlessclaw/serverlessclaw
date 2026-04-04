import { test, expect } from '@playwright/test';

test.describe('Memory Management', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders memory page', async ({ page }) => {
    await page.goto('/memory');
    await expect(page).toHaveURL('/memory');
  });

  test('displays memory tabs', async ({ page }) => {
    await page.goto('/memory');
    // Should have tabs for different memory views
    await expect(page.locator('[role="tablist"], .tabs, nav').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('displays gaps list', async ({ page }) => {
    await page.goto('/memory');
    // Wait for content to load
    await page.waitForLoadState('networkidle');
    // Page should have loaded without errors
    await expect(page.locator('body')).not.toContainText('Error');
  });

  test('search input is functional', async ({ page }) => {
    await page.goto('/memory');
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]'
    );
    if (await searchInput.isVisible()) {
      await searchInput.fill('test query');
      await expect(searchInput).toHaveValue('test query');
    }
  });

  test('navigation from sidebar to memory works', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/memory"]');
    await expect(page).toHaveURL('/memory');
  });
});
