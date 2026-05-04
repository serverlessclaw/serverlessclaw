/**
 * Global Vitest setup for @serverlessclaw/core
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

(global as unknown as { __CLAW_TEST__: boolean }).__CLAW_TEST__ = true;
(global as unknown as { CLAW_TEST: boolean }).CLAW_TEST = true;
(global as unknown as { IS_CLAW_TEST: boolean }).IS_CLAW_TEST = true;
process.env.CLAW_TEST = 'true';
process.env.VITEST = 'true';
process.env.CORE_TEST = 'true';

// Global mock for TokenBudgetEnforcer to ensure tests don't fail due to DDB outages
vi.mock('@claw/core/lib/metrics/token-budget-enforcer', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getTokenBudgetEnforcer: () => ({
      recordUsage: vi.fn().mockResolvedValue({
        allowed: true,
        sessionCostUsd: 0,
        sessionTokens: 0,
        percentUsed: 0,
      }),
      checkBudget: vi.fn().mockResolvedValue({
        allowed: true,
        sessionCostUsd: 0,
        sessionTokens: 0,
        percentUsed: 0,
      }),
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn(),
      getSummary: vi.fn().mockReturnValue([]),
      loadSession: vi.fn().mockResolvedValue([]),
    }),
  };
});

// Also handle relative imports
vi.mock('../lib/metrics/token-budget-enforcer', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getTokenBudgetEnforcer: () => ({
      recordUsage: vi.fn().mockResolvedValue({
        allowed: true,
        sessionCostUsd: 0,
        sessionTokens: 0,
        percentUsed: 0,
      }),
      checkBudget: vi.fn().mockResolvedValue({
        allowed: true,
        sessionCostUsd: 0,
        sessionTokens: 0,
        percentUsed: 0,
      }),
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn(),
      getSummary: vi.fn().mockReturnValue([]),
      loadSession: vi.fn().mockResolvedValue([]),
    }),
  };
});

// Global mock for CircuitBreaker to ensure tests don't fail due to DDB outages
vi.mock('../lib/safety/circuit-breaker', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    getCircuitBreaker: (...args: unknown[]) => { canProceed: (...args: unknown[]) => unknown };
    [key: string]: unknown;
  };
  return {
    ...actual,
    getCircuitBreaker: (...args: unknown[]) => {
      const instance = actual.getCircuitBreaker(...args);
      // Only mock canProceed if we are NOT in a circuit-breaker test file
      if (
        typeof expect !== 'undefined' &&
        !/circuit-breaker.*\.test/.test(expect.getState().testPath || '')
      ) {
        instance.canProceed = vi.fn().mockResolvedValue({ allowed: true, state: 'closed' });
      }
      return instance;
    },
  };
});

// Shared mocks or global settings can be added here
