import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ request }) => {
  const password = process.env.DASHBOARD_PASSWORD || 'test-password';
  console.log(
    `[E2E:Auth] Authenticating via API with password from ${process.env.DASHBOARD_PASSWORD ? 'env' : 'fallback'}`
  );

  const response = await request.post('/api/auth/login', {
    data: { password },
  });

  expect(response.status()).toBe(200);

  const data = await response.json();
  expect(data.success).toBe(true);

  // Save authentication state from the API context
  await request.storageState({ path: authFile });
  console.log('[E2E:Auth] Authentication state saved successfully via API');
});
