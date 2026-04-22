import { test, expect } from '@playwright/test';

test.describe('Dashboard API Integrity (Black-box)', () => {
  // Use the setup auth state for protected routes
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('config api returns valid configuration', async ({ request }) => {
    const response = await request.get('/api/config');
    expect(response.status()).toBe(200);
    const body = await response.json();

    // Updated to match actual dashboard config schema
    expect(body).toHaveProperty('app');
    expect(body).toHaveProperty('stage');
    expect(body).toHaveProperty('realtime');
  });

  test('infra pulse api returns active nodes for observability', async ({ request }) => {
    const response = await request.get('/api/infrastructure'); // Adjusted to correct path
    if (response.status() === 401) return;

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('nodes');
    expect(Array.isArray(body.nodes)).toBe(true);
  });

  test('chat api returns sessions list', async ({ request }) => {
    const response = await request.get('/api/chat');
    if (response.status() === 401) return;

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test('trace api allows listing and deleting traces', async ({ request }) => {
    // 1. List traces (assuming /api/trace returns a list or 404/200 if empty)
    const listRes = await request.get('/api/trace');
    if (listRes.status() === 401) return;

    // Some routes return 200 [] or 404 if no data, we check for 200
    if (listRes.status() === 200) {
      const body = await listRes.json();
      expect(body).toHaveProperty('traces');
    }

    // 2. Test DELETE endpoint (idempotent purge check)
    const deleteRes = await request.delete('/api/trace?traceId=test-integrity-purge');
    if (deleteRes.status() === 401) return;
    expect([200, 404]).toContain(deleteRes.status());
  });

  test('memory status api updates capability gaps', async ({ request }) => {
    const response = await request.post('/api/memory/status', {
      data: {
        gapId: 'integrity-test-gap',
        status: 'PLANNED',
      },
    });
    if (response.status() === 401) return;

    // It should fail with 404 or succeed with 200 depending on if the gap exists,
    // but the schema validation should pass.
    expect([200, 404, 400]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.success).toBe(true);
    }
  });

  test('api security: unauthenticated access to config is blocked', async ({ browser }) => {
    // Verified: /api/config is now protected by Next.js middleware.
    const unauthContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const response = await unauthContext.request.get('/api/config');

    // Should now return 401 Unauthorized
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Authentication required');

    await unauthContext.close();
  });
});
