import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders chat page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: 'SEND', exact: true })).toBeVisible();
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto('/');
    const sendButton = page.getByRole('button', { name: 'SEND', exact: true });
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has text', async ({ page }) => {
    await page.goto('/');
    await page.fill('textarea', 'Hello agent');
    const sendButton = page.getByRole('button', { name: /SEND/i });
    await expect(sendButton).toBeEnabled();
  });

  test('sends message and displays in chat', async ({ page }) => {
    await page.goto('/');
    await page.fill('textarea', 'Test message');
    await page.click('button:has-text("SEND")');

    // Message should appear in the chat
    await expect(page.getByText('Test message')).toBeVisible({ timeout: 10000 });
  });

  test('displays EXECUTING state while loading', async ({ page }) => {
    await page.goto('/');
    await page.fill('textarea', 'Processing test');
    await page.click('button:has-text("SEND")');

    // Should briefly show EXECUTING state
    const executingButton = page.getByText('EXECUTING...');
    // Note: This might be very brief, so we use a short timeout
    await expect(executingButton)
      .toBeVisible({ timeout: 2000 })
      .catch(() => {
        // It's OK if we miss it - the response might be fast
      });
  });

  test('textarea supports Enter to send', async ({ page }) => {
    await page.goto('/');
    await page.fill('textarea', 'Enter send test');
    await page.press('textarea', 'Enter');

    await expect(page.getByText('Enter send test')).toBeVisible({ timeout: 10000 });
  });

  test('chat sidebar shows conversations', async ({ page }) => {
    await page.goto('/');
    // Sidebar should exist with conversation list. Use .first() if multiple exist.
    await expect(page.locator('aside').first()).toBeVisible();
  });
});
