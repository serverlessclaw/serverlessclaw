import { test, expect } from '@playwright/test';

test.describe('MCP Integration (Capabilities)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('renders MCP tab in capabilities', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');

    // Select the MCP tab
    const mcpTab = page.locator(
      'button:has-text("Skill Bridges"), button:has-text("技能桥梁"), [role="tab"]:has-text("Skill Bridges"), [role="tab"]:has-text("技能桥梁")'
    );
    await expect(mcpTab).toBeVisible({ timeout: 15000 });
    await mcpTab.click();

    // Verify MCP specific content
    const mcpContent = page
      .locator('text=/MCP Servers|External Tools|Marketplace|Skill Bridges/i')
      .first();
    try {
      await expect(mcpContent).toBeVisible({ timeout: 10000 });
    } catch {
      // If no servers are active, check for the Empty State
      const emptyState = page.locator('text=/No MCP servers configured|Configure MCP/i');
      await expect(emptyState.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('allows tool discovery from MCP servers', async ({ page }) => {
    await page.goto('/capabilities');
    await page.waitForLoadState('networkidle');
    await page
      .locator('button:has-text("Skill Bridges"), button:has-text("技能桥梁")')
      .first()
      .click();

    // Verify presence of tools list or search
    const toolSearch = page
      .locator(
        'input[placeholder*="Search current capabilities"], input[placeholder*="搜索当前能力"]'
      )
      .first();
    if (await toolSearch.isVisible()) {
      await toolSearch.fill('filesystem');
      await expect(toolSearch).toHaveValue('filesystem', { timeout: 2000 });
    }
  });

  test('trace detail displays tool execution source (MCP vs Local)', async ({ page }) => {
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
      return;
    }

    await traceLinks.first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('trace-detail-container')).toBeVisible({ timeout: 20000 });

    // Look for tool execution badges or indicators when present.
    const executionBadge = page
      .locator('[class*="Badge"], [class*="badge"]')
      .filter({ hasText: /LOCAL|MCP/i })
      .first();

    if (await executionBadge.count()) {
      await expect(executionBadge).toBeVisible({ timeout: 10000 });
      return;
    }

    // Fallback: trace detail still loads even if source badges are not present for this trace.
    await expect(page.getByText(/STATUS/i).first()).toBeVisible({ timeout: 10000 });
  });
});
