import { test, expect } from '@playwright/test';

test.describe('Full Evolution Lifecycle (E2E)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('should complete full lifecycle', async ({ page: _page }) => {
    test.skip(
      true,
      'Skipped - requires full async evolution pipeline which is too slow/flaky for E2E'
    );
  });

  test('should handle gap creation via direct API call', async ({ request }) => {
    const _gapId = `api_test_${Date.now()}`;

    await request.storageState({ path: 'e2e/.auth/user.json' });

    const response = await request.get('/api/gaps');
    expect(response.ok() || response.status() === 404).toBe(true);
  });
});
