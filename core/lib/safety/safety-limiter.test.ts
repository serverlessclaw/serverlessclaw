/**
 * @module SafetyRateLimiter Tests
 * @description Tests for rate limiting including hourly/daily limits,
 * in-memory fallback, tool-specific limits, and DDB atomic counters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyRateLimiter } from './safety-limiter';
import { SafetyTier } from '../types/agent';

// Mock Logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Memory Provider
const mockMemoryProvider = {
  get: vi.fn(),
  set: vi.fn(),
  updateItem: vi.fn(),
  getScopedUserId: vi.fn((userId) => userId),
};

vi.mock('../constants', async () => ({
  ...((await vi.importActual('../constants')) as any),
  MEMORY_KEYS: { HEALTH_PREFIX: 'HEALTH#' },
}));

function createPolicy(overrides: Partial<any> = {}) {
  return {
    tier: SafetyTier.LOCAL,
    requireCodeApproval: false,
    requireDeployApproval: false,
    requireFileApproval: false,
    requireShellApproval: false,
    requireMcpApproval: false,
    ...overrides,
  };
}

describe('SafetyRateLimiter', () => {
  let limiter: SafetyRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default limiter uses in-memory if no provider passed
    limiter = new SafetyRateLimiter();
  });

  describe('checkRateLimits (In-Memory Fallback)', () => {
    it('should allow actions within limits', async () => {
      const policy = createPolicy({ maxDeploymentsPerDay: 5 });
      const result = await limiter.checkRateLimits(policy, 'deployment');
      expect(result.allowed).toBe(true);
    });

    it('should block actions exceeding daily limits', async () => {
      const policy = createPolicy({ maxDeploymentsPerDay: 2 });

      await limiter.checkRateLimits(policy, 'deployment');
      await limiter.checkRateLimits(policy, 'deployment');
      const result = await limiter.checkRateLimits(policy, 'deployment');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit');
    });

    it('should block actions exceeding hourly limits', async () => {
      const policy = createPolicy({ maxShellCommandsPerHour: 2 });

      await limiter.checkRateLimits(policy, 'shell_command');
      await limiter.checkRateLimits(policy, 'shell_command');
      const result = await limiter.checkRateLimits(policy, 'shell_command');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hour');
    });

    it('should track different actions separately', async () => {
      const policy = createPolicy({ maxDeploymentsPerDay: 1, maxFileWritesPerHour: 1 });

      await limiter.checkRateLimits(policy, 'deployment');
      const result = await limiter.checkRateLimits(policy, 'file_operation');

      expect(result.allowed).toBe(true);
    });
  });

  describe('checkToolRateLimit', () => {
    it('should enforce tool-specific daily limits', async () => {
      const override = { toolName: 'testTool', maxUsesPerDay: 2 };

      await limiter.checkToolRateLimit(override, 'testTool');
      await limiter.checkToolRateLimit(override, 'testTool');
      const result = await limiter.checkToolRateLimit(override, 'testTool');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit');
    });

    it('should enforce tool-specific hourly limits', async () => {
      const override = { toolName: 'testTool', maxUsesPerHour: 1 };

      await limiter.checkToolRateLimit(override, 'testTool');
      const result = await limiter.checkToolRateLimit(override, 'testTool');

      expect(result.allowed).toBe(false);
    });
  });

  describe('Distributed Rate Limiting (Memory Provider)', () => {
    it('should use memory provider updateItem if available', async () => {
      const distributedLimiter = new SafetyRateLimiter(mockMemoryProvider as any);
      const policy = createPolicy({ maxDeploymentsPerDay: 5 });

      mockMemoryProvider.updateItem.mockResolvedValue({});

      const result = await distributedLimiter.checkRateLimits(policy, 'deployment');

      expect(result.allowed).toBe(true);
      expect(mockMemoryProvider.updateItem).toHaveBeenCalled();
    });

    it('should fail-closed if memory provider throws (security: prevent rate limit bypass)', async () => {
      const distributedLimiter = new SafetyRateLimiter(mockMemoryProvider as any);
      const policy = createPolicy({ maxDeploymentsPerDay: 5 });

      mockMemoryProvider.updateItem.mockRejectedValue(new Error('DDB Down'));

      const result = await distributedLimiter.checkRateLimits(policy, 'deployment');

      expect(result.allowed).toBe(false); // Fail closed - reject if we can't verify
    });

    it('should isolate rate limits by workspaceId', async () => {
      const distributedLimiter = new SafetyRateLimiter(mockMemoryProvider as any);
      const policy = createPolicy({ maxDeploymentsPerDay: 5 });

      mockMemoryProvider.updateItem.mockResolvedValue({});
      (mockMemoryProvider.getScopedUserId as any).mockImplementation(
        (userId: any, workspaceId: any) => (workspaceId ? `WS#${workspaceId}#${userId}` : userId)
      );

      await distributedLimiter.checkRateLimits(policy, 'deployment', 'workspace-A');

      expect(mockMemoryProvider.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({
            userId: expect.stringMatching(/^WS#workspace-A#HEALTH#RATE#deployment_day_/),
          }),
        })
      );
    });
  });

  describe('Cleanup and pruning', () => {
    it('should prune old in-memory entries to prevent leak', async () => {
      const policy = createPolicy({ maxShellCommandsPerHour: 1000 });

      // Fill up with many entries
      for (let i = 0; i < 100; i++) {
        await limiter.checkRateLimits(policy, 'shell_command');
      }

      // The 100th call triggers pruning - just verify no errors
      const result = await limiter.checkRateLimits(policy, 'shell_command');
      expect(result.allowed).toBe(true);
    });
  });
});
