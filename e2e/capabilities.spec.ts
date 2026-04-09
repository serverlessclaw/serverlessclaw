import { test, expect } from '@playwright/test';

test.describe('Capabilities / Tools & Skills', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders capabilities page', async ({ page }) => {
    await page.goto('/capabilities');
    await expect(page).toHaveURL('/capabilities');
  });

  test('displays tab navigation', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');
    // Should have tabs for different views
    const tabs = page.locator(
      '[role="tab"], button:has-text("Agents"), button:has-text("Library"), button:has-text("MCP")'
    );
    await expect(tabs.first()).toBeVisible({ timeout: 10000 });
  });

  test('can switch between tabs', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');

    // Click on Library tab if it exists
    const libraryTab = page.locator('button:has-text("Library"), [role="tab"]:has-text("Library")');
    if (await libraryTab.isVisible()) {
      await libraryTab.click();
      // Content should change; wait for library header or content
      await expect(page.locator('text=/Library/i')).toBeVisible({ timeout: 5000 });
    }
  });

  test('navigation from sidebar to capabilities works', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/capabilities"]');
    await expect(page).toHaveURL('/capabilities');
  });
});
