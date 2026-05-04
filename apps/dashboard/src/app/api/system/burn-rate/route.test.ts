import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock the core dependencies without breaking other constants
vi.mock('@claw/core/lib/memory/base', () => ({
  BaseMemoryProvider: class {
    listByPrefix = vi.fn().mockImplementation(() => {
      const now = Date.now();
      return Promise.resolve([
        {
          userId: 'TOKEN_ROLLUP#agent1',
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          invocationCount: 10,
          timestamp: now,
        },
        {
          userId: 'TOKEN_ROLLUP#agent2',
          totalInputTokens: 2000,
          totalOutputTokens: 1000,
          invocationCount: 20,
          timestamp: now,
        },
      ]);
    });
  },
}));

vi.mock('@claw/core/lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(1000000), // budget: 1M tokens
  },
}));

// Use a partial mock for CONFIG_DEFAULTS to avoid breaking system constants
vi.mock('@claw/core/lib/config/config-defaults', async (importActual) => {
  const actual = await importActual<typeof import('@claw/core/lib/config/config-defaults')>();
  return {
    ...actual,
    CONFIG_DEFAULTS: {
      ...actual.CONFIG_DEFAULTS,
      GLOBAL_TOKEN_BUDGET: { code: 'global_token_budget' },
    },
  };
});

describe('Burn-Rate API', () => {
  it('should calculate daily burn rate against budget', async () => {
    // Note: GET signature is (body, req) in withApiHandler
    const response = await GET(
      new Request('http://localhost/api/system/burn-rate') as unknown as NextRequest
    );
    const data = await response.json();

    expect(data).toHaveProperty('totalTokens');
    expect(data).toHaveProperty('burnRatePerHour');
    expect(data.totalTokens).toBe(4500); // (1000+500) + (2000+1000)
    expect(data.usageRatio).toBe(4500 / 1000000);
  });
});
