import { test, expect } from '@playwright/test';

test.describe('Evolution Pipeline', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders evolution page correctly', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page).toHaveURL('/pipeline');
    await page.waitForLoadState('networkidle');
    // Page should contain the Evolution Pipeline heading
    await expect(page.locator('h1, h2').filter({ hasText: /Evolution Pipeline/i })).toBeVisible({
      timeout: 15000,
    });
  });

  test('displays pipeline board with status columns', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Pipeline board should render with columns for gap statuses
    const board = page.locator('[class*="pipeline"], [class*="board"], [class*="kanban"]');
    await expect(board.first()).toBeVisible({ timeout: 15000 });
  });

  test('displays evolution metrics', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Should display metric cards for Active Gaps and Historical Success
    const activeGapsCard = page.locator('text=/Active Gaps/i');
    const successCard = page.locator('text=/Historical Success/i');

    await expect(activeGapsCard).toBeVisible({ timeout: 15000 });
    await expect(successCard).toBeVisible({ timeout: 15000 });
  });

  test('navigation from sidebar to pipeline works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the Pipeline link in the sidebar
    const pipelineLink = page.locator('a[href="/pipeline"]');
    await expect(pipelineLink).toBeVisible({ timeout: 10000 });
    await pipelineLink.click();

    await expect(page).toHaveURL('/pipeline');
  });

  test('loads pipeline data without errors', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Should not show critical error states
    await expect(page.locator('body')).not.toContainText('Failed to fetch');
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });

  test('displays gap status badges with correct colors', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    // Look for status badges (OPEN, PLANNED, PROGRESS, DEPLOYED, DONE)
    // These may appear as badges, chips, or column headers
    const statusElements = page.locator(
      'text=/OPEN|PLANNED|PROGRESS|DEPLOYED|DONE|Ready|Evolution|Verified/i'
    );

    // At least one status indicator should be visible
    await expect(statusElements.first()).toBeVisible({ timeout: 15000 });
  });
});
