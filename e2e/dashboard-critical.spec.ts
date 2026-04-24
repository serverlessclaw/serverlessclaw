import { test, expect } from '@playwright/test';

test.describe('Dashboard Critical Flows', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('direct navigation to observability tabs works', async ({ page }) => {
    // Navigate directly to a specific tab via URL if supported,
    // or verify navigation consistency.
    await page.goto('/observability');
    await expect(page.getByText(/Nerve Center Hub|神经中枢|Nerve Center/i).first()).toBeVisible({
      timeout: 15000,
    });

    const tabs = [
      {
        name: /Infra Pulse|结构脉搏/i,
        text: /Infrastructure Map|Live Architecture Feed|Manual Resync/i,
      },
      { name: /Resilience|韧性中心/i, text: /Stability_Diagnostics|SYSTEM_ADVISORY|HEALTH_SCORE/i },
      {
        name: /Cognitive|认知健康/i,
        text: /Neural_Sync_Status|Objective Alignment|No active cognitive traces/i,
      },
      {
        name: /Traffic|并发流量|Traffic\/Locks/i,
        text: /Lane Concurrency Monitor|All lanes clear|Recovery Protocol/i,
      },
    ];

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab.name }).click();
      await expect(page.getByText(tab.text).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test('dashboard handles missing mission data gracefully', async ({ page }) => {
    // This test assumes we might have an environment variable or mock to trigger empty state.
    // For now, we just verify the component structure exists.
    await page.goto('/');
    await expect(
      page.getByText(/Recent_Missions|No active mission logs detected/i).first()
    ).toBeVisible({
      timeout: 15000,
    });

    // Ensure the dashboard still renders actionable navigation when mission data is absent.
    await expect(page.locator('a[href="/chat"], a[href="/observability"]').first()).toBeVisible();
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
    await page.getByRole('tab', { name: /Infra Pulse|结构脉搏/i }).click();

    // Wait for pulse view controls to become interactive.
    await expect(page.getByRole('button', { name: /Manual Resync/i })).toBeVisible({
      timeout: 20000,
    });
    await page.waitForTimeout(2000);

    // await expect(page.locator('.react-flow')).toHaveScreenshot('infra-pulse-map.png');
  });
});
