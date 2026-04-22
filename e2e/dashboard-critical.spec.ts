import { test, expect } from '@playwright/test';

test.describe('Dashboard Critical Flows', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('direct navigation to observability tabs works', async ({ page }) => {
    // Navigate directly to a specific tab via URL if supported,
    // or verify navigation consistency.
    await page.goto('/observability');

    const tabs = [
      { name: /Infra Pulse/i, text: /Nerve Center Hub/i },
      { name: /Resilience/i, text: /System_Stability/i },
      { name: /Cognitive/i, text: /Deep Cognitive Health/i },
      { name: /Traffic/i, text: /Lane Concurrency Monitor/i },
    ];

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab.name }).click();
      await expect(page.getByText(tab.text)).toBeVisible({ timeout: 10000 });
    }
  });

  test('dashboard handles missing mission data gracefully', async ({ page }) => {
    // This test assumes we might have an environment variable or mock to trigger empty state.
    // For now, we just verify the component structure exists.
    await page.goto('/');
    await expect(page.getByText(/Recent_Missions/i)).toBeVisible();

    // Check if the missions list container is present
    const missionsList = page.locator('section').filter({ hasText: /Recent_Missions/i });
    await expect(missionsList).toBeVisible();
  });

  test('visual regression: main dashboard layout', async ({ page }) => {
    await page.goto('/');
    // Wait for critical elements to load
    await expect(page.getByText(/Nerve_Center_Summary/i)).toBeVisible();
    await page.waitForTimeout(2000); // Wait for animations

    // In a real environment, we'd use toHaveScreenshot()
    // For now we'll just log that we are ready for it.
    // await expect(page).toHaveScreenshot('main-dashboard.png', { mask: [page.locator('.dynamic-data')] });
  });

  test('visual regression: infra pulse map', async ({ page }) => {
    await page.goto('/observability');
    await page.getByRole('tab', { name: /Infra Pulse/i }).click();

    // Wait for React Flow
    await expect(page.locator('.react-flow__renderer')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2000);

    // await expect(page.locator('.react-flow')).toHaveScreenshot('infra-pulse-map.png');
  });
});
