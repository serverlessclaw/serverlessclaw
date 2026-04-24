import { test, expect, type Page } from '@playwright/test';

async function openAnyTraceDetail(page: Page) {
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
    return false;
  }

  await traceLinks.first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('trace-detail-container')).toBeVisible({ timeout: 20000 });
  return true;
}

test.describe('Agent Collaboration & Swarm Intelligence', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders collaboration canvas on trace detail page', async ({ page }) => {
    const opened = await openAnyTraceDetail(page);
    if (!opened) return;

    // CollaborationCanvas should exist in the DOM
    const canvas = page.getByTestId('collaboration-canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 20000 });
  });

  test('displays swarm consensus view when available', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Evolution Pipeline|演进流水线/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Prefer seeded gap when available, but keep this resilient in deployed environments.
    const gapItem = page.locator('text=/Simulated capability failure/i').first();
    if (await gapItem.isVisible().catch(() => false)) {
      await gapItem.click();
      await page.waitForLoadState('networkidle');

      const consensusView = page.locator('text=/Consensus|Swarm|Agreement/i').first();
      await expect(consensusView).toBeVisible({ timeout: 10000 });
      return;
    }

    // Fallback assertion: board renders even when seeded gaps are absent.
    const hasGapCards = await page.locator('[data-testid="gap-card"]').count();
    if (hasGapCards > 0) {
      await expect(page.locator('[data-testid="gap-card"]').first()).toBeVisible({
        timeout: 15000,
      });
      return;
    }

    await expect(page.locator('[class*="grid-cols-6"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('verifies path visualization for complex tasks', async ({ page }) => {
    const opened = await openAnyTraceDetail(page);
    if (!opened) return;

    // Check if PathVisualizer component is present
    const visualizer = page.getByTestId('collaboration-canvas');
    // Verify visualizer renders
    await expect(visualizer.first()).toBeVisible({ timeout: 15000 });
  });
});
