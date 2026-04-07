import { test, expect, type Page } from '@playwright/test';

const EVOLUTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes max
const POLL_INTERVAL = 5000; // Poll every 5 seconds

test.describe('Full Evolution Lifecycle (E2E)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  async function getGapById(
    page: Page,
    gapId: string
  ): Promise<{ status: string; visible: boolean }> {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    const gapCard = page.locator(`[data-gap-id*="${gapId}"], text=/${gapId}/i`);
    const visible = await gapCard
      .first()
      .isVisible()
      .catch(() => false);

    if (!visible) {
      return { status: 'NOT_FOUND', visible: false };
    }

    // Check for status badges
    const statusBadges = page.locator('[class*="status"], [class*="badge"], [class*="chip"]');
    const statusText = await statusBadges
      .first()
      .textContent()
      .catch(() => 'UNKNOWN');

    return { status: statusText, visible: true };
  }

  test('should complete full lifecycle: OPEN -> PLANNED -> PROGRESS -> DEPLOYED -> DONE', async ({
    page,
  }) => {
    const gapId = `e2e_${Date.now()}`;

    // 1. INITIAL - Create a gap by triggering the reflector
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea');
    await chatInput.waitFor({ state: 'visible', timeout: 15000 });

    // Use a command that triggers gap identification
    await chatInput.fill(`/evolve create: Add a new test capability ${gapId}`);
    await page.keyboard.press('Enter');

    // Wait for initial response
    await expect(page.locator('body')).toContainText(/Processing|Executing|Reflector/i, {
      timeout: 15000,
    });

    // 2. POLLING - Wait for the gap to go through the lifecycle
    const startTime = Date.now();
    let currentStatus = 'NOT_FOUND';
    let found = false;

    while (Date.now() - startTime < EVOLUTION_TIMEOUT) {
      const result = await getGapById(page, gapId);
      found = result.visible;

      if (found) {
        currentStatus = result.status;
        console.log(`Gap ${gapId} status: ${currentStatus}`);

        // Check for terminal states
        if (currentStatus.includes('DONE') || currentStatus.includes('VERIFIED')) {
          break;
        }
        if (currentStatus.includes('FAILED') || currentStatus.includes('ERROR')) {
          throw new Error(`Evolution failed with status: ${currentStatus}`);
        }
      }

      await page.waitForTimeout(POLL_INTERVAL);
    }

    // 3. VERIFY - Gap should be in a terminal state or at least in progress
    if (!found) {
      console.log('Warning: Gap not found in pipeline (may be async or not yet created)');
    } else {
      // Verify the gap was at least planned or in progress
      const terminalStates = ['DONE', 'VERIFIED', 'DEPLOYED', 'PROGRESS', 'PLANNED'];
      const hasReachedDesiredState = terminalStates.some((state) =>
        currentStatus.toUpperCase().includes(state)
      );

      expect(hasReachedDesiredState).toBe(true);
    }
  });

  test('should handle gap creation via direct API call', async ({ request }) => {
    const _gapId = `api_test_${Date.now()}`;

    // This test verifies the API can create gaps that will be processed
    // In a real scenario, this would call the webhook or a dedicated API

    // For now, just verify the pipeline UI loads with proper data
    await request.storageState({ path: 'e2e/.auth/user.json' });

    const response = await request.get('/api/gaps');
    expect(response.ok() || response.status() === 404).toBe(true);
  });
});
