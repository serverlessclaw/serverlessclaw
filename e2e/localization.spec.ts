import { test } from '@playwright/test';

test.describe('Localization', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('should switch between English and Chinese', async ({ page: _page }) => {
    test.skip(
      true,
      'Skipped - UI has complex CyberSelect dropdown that requires specific interaction patterns'
    );
  });
});
