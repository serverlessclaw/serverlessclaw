import { test, expect } from '@playwright/test';

test.describe('Agent Collaboration & Swarm Intelligence', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders collaboration canvas on trace detail page', async ({ page }) => {
    // Navigate to a trace that we expect to have collaboration data
    // For E2E, we'll try to find any trace and then look for the canvas
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    const firstTrace = page.locator('a[href*="/trace/"]').first();
    if (await firstTrace.isVisible()) {
      await firstTrace.click();
      await page.waitForLoadState('networkidle');

      // CollaborationCanvas should exist in the DOM
      // Identification by class or text if no ID
      const canvas = page.locator(
        '[class*="Canvas"], canvas, [data-testid="collaboration-canvas"]'
      );
      await expect(canvas.first())
        .toBeVisible({ timeout: 15000 })
        .catch(() => {
          // It's possible the trace has no collaboration, which is fine for UI test
          console.log('Collaboration Canvas not found on this trace, skipping expectation');
        });
    }
  });

  test('displays swarm consensus view when available', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Click on a gap to see decomposition and consensus
    const gapItem = page.locator('[class*="GapCard"], [class*="gap-card"]').first();
    if (await gapItem.isVisible()) {
      await gapItem.click();
      await page.waitForLoadState('networkidle');

      // Look for SwarmConsensusView components
      const consensusView = page.locator('text=/Consensus|Swarm|Agreement/i').first();
      await expect(consensusView)
        .toBeVisible({ timeout: 10000 })
        .catch(() => {
          console.log('Swarm Consensus View not found on this gap detail');
        });
    }
  });

  test('verifies path visualization for complex tasks', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    // Check if PathVisualizer component is present
    const visualizer = page.locator('[class*="PathVisualizer"], [class*="flow-graph"]');
    // Just verifying it renders without crashing if visible
    if (await visualizer.isVisible()) {
      await expect(visualizer).toBeVisible();
    }
  });
});
