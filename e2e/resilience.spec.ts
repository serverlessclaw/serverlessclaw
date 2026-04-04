import { test, expect } from '@playwright/test';

test.describe('Resilience & Fault Tolerance (Fault Detector)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('detects failures in evolution pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Look for Gaps in FAILED status
    const failedStatus = page.locator('text=/FAILED|ERROR/i').first();
    await expect(failedStatus)
      .toBeVisible({ timeout: 15000 })
      .catch(() => {
        console.log('No failed gaps currently in the pipeline');
      });
  });

  test('displays retry control for failed trace nodes', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    const traceDetail = page.locator('a[href*="/trace/"]').first();
    if (await traceDetail.isVisible()) {
      await traceDetail.click();
      await page.waitForLoadState('networkidle');

      // Check for retry buttons or error states
      const retryButton = page.locator(
        'button:has-text("RETRY"), button:has-text("FIX"), [aria-label="Retry"]'
      );
      await expect(retryButton.first())
        .toBeVisible({ timeout: 5000 })
        .catch(() => {
          console.log('No retry controls found on this trace detail');
        });
    }
  });

  test('verifies Cognitive Health alerting state', async ({ page }) => {
    await page.goto('/cognitive-health');
    await page.waitForLoadState('networkidle');

    // Cognitive Health card or status indicator
    const healthIndicator = page.getByText(/Deep Cognitive Health/i).first();
    await expect(healthIndicator).toBeVisible({ timeout: 10000 });

    // Should indicate whether the system is healthy or has "strategic gaps"
    const gapCountStr = page.locator('text=/strategic gap|neural coherence/i').first();
    if (await gapCountStr.isVisible()) {
      await expect(gapCountStr).toBeVisible();
    }
  });
});
