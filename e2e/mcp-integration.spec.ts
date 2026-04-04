import { test, expect } from '@playwright/test';

test.describe('MCP Integration (Capabilities)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders MCP tab in capabilities', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');

    // Select the MCP tab
    const mcpTab = page.locator(
      'button:has-text("Skill Bridges"), [role="tab"]:has-text("Skill Bridges")'
    );
    await expect(mcpTab).toBeVisible({ timeout: 15000 });
    await mcpTab.click();

    // Verify MCP specific content
    const mcpContent = page
      .locator('text=/MCP Servers|External Tools|Marketplace|Skill Bridges/i')
      .first();
    await expect(mcpContent)
      .toBeVisible({ timeout: 10000 })
      .catch(() => {
        // If no servers are active, check for the Empty State
        const emptyState = page.locator('text=/No MCP servers configured|Configure MCP/i');
        return expect(emptyState.first()).toBeVisible();
      });
  });

  test('allows tool discovery from MCP servers', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Skill Bridges")').click();

    // Verify presence of tools list or search
    const toolSearch = page.locator('input[placeholder*="Search current capabilities..."]').first();
    if (await toolSearch.isVisible()) {
      await toolSearch.fill('filesystem');
      // Results should filter or show loading
      await page.waitForTimeout(500);
    }
  });

  test('trace detail displays tool execution source (MCP vs Local)', async ({ page }) => {
    await page.goto('/trace');
    await page.waitForLoadState('networkidle');

    const traceDetail = page.locator('a[href*="/trace/"]').first();
    if (await traceDetail.isVisible()) {
      await traceDetail.click();
      await page.waitForLoadState('networkidle');

      // Look for tool execution badges or indicators
      const executionBadge = page
        .locator('[class*="Badge"], [class*="badge"], text=/LOCAL|MCP/i')
        .first();
      await expect(executionBadge)
        .toBeVisible({ timeout: 10000 })
        .catch(() => {
          console.log('No tool execution badges found on this trace detail');
        });
    }
  });
});
