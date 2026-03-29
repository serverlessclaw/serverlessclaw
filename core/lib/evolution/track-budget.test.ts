/**
 * @module TrackBudgetAllocator Tests
 * @description Tests for ConfigManager-backed multi-track budget allocation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackBudgetAllocator } from './track-budget';
import { EvolutionTrack } from '../types/agent';
import { ConfigManager } from '../registry/config';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createFreshState() {
  return {
    cycleId: '2026-03-29',
    totalBudgetUsd: 10.0,
    expiresAt: Date.now() + 7 * 86400000,
    allocations: {
      [EvolutionTrack.SECURITY]: { allocatedUsd: 3.0, spentUsd: 0 },
      [EvolutionTrack.PERFORMANCE]: { allocatedUsd: 2.5, spentUsd: 0 },
      [EvolutionTrack.FEATURE]: { allocatedUsd: 2.0, spentUsd: 0 },
      [EvolutionTrack.INFRASTRUCTURE]: { allocatedUsd: 1.5, spentUsd: 0 },
      [EvolutionTrack.REFACTORING]: { allocatedUsd: 1.0, spentUsd: 0 },
    },
    spendHistory: [],
  };
}

describe('TrackBudgetAllocator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a fresh state
    vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(createFreshState());
  });

  describe('canSpend', () => {
    it('should return true when budget available', async () => {
      const result = await TrackBudgetAllocator.canSpend(EvolutionTrack.SECURITY, 1.0);
      expect(result).toBe(true);
    });

    it('should return false when budget exhausted', async () => {
      const state = createFreshState();
      state.allocations[EvolutionTrack.SECURITY].spentUsd = 3.0;
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(state);

      const result = await TrackBudgetAllocator.canSpend(EvolutionTrack.SECURITY, 0.01);
      expect(result).toBe(false);
    });

    it('should return false for unknown track', async () => {
      const state = createFreshState();
      delete (state.allocations as Record<string, unknown>).unknown_track;
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(state);

      const result = await TrackBudgetAllocator.canSpend('unknown_track' as EvolutionTrack, 0.01);
      expect(result).toBe(false);
    });
  });

  describe('recordSpend', () => {
    it('should record spend and persist', async () => {
      const result = await TrackBudgetAllocator.recordSpend(
        EvolutionTrack.SECURITY,
        'gap-1',
        0.5,
        'agent-1'
      );
      expect(result).toBe(true);
      expect(ConfigManager.saveRawConfig).toHaveBeenCalledWith(
        'track_evolution_budget',
        expect.objectContaining({
          allocations: expect.objectContaining({
            [EvolutionTrack.SECURITY]: expect.objectContaining({
              spentUsd: 0.5,
            }),
          }),
        })
      );
    });

    it('should reject spend when budget exceeded', async () => {
      const state = createFreshState();
      state.allocations[EvolutionTrack.SECURITY].spentUsd = 3.0;
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(state);

      const result = await TrackBudgetAllocator.recordSpend(
        EvolutionTrack.SECURITY,
        'gap-1',
        0.5,
        'agent-1'
      );
      expect(result).toBe(false);
      expect(ConfigManager.saveRawConfig).not.toHaveBeenCalled();
    });

    it('should add to spend history', async () => {
      await TrackBudgetAllocator.recordSpend(EvolutionTrack.FEATURE, 'gap-5', 0.3, 'agent-2');

      const saveCall = vi.mocked(ConfigManager.saveRawConfig).mock.calls[0];
      const savedState = saveCall?.[1] as {
        spendHistory: Array<{ gapId: string; spendUsd: number }>;
      };
      expect(savedState.spendHistory).toContainEqual(
        expect.objectContaining({ gapId: 'gap-5', spendUsd: 0.3 })
      );
    });
  });

  describe('getAllocation', () => {
    it('should return allocation with remaining', async () => {
      const result = await TrackBudgetAllocator.getAllocation(EvolutionTrack.SECURITY);
      expect(result).toEqual({
        allocatedUsd: 3.0,
        spentUsd: 0,
        remainingUsd: 3.0,
      });
    });

    it('should return null for unknown track', async () => {
      const result = await TrackBudgetAllocator.getAllocation('nonexistent' as EvolutionTrack);
      expect(result).toBeNull();
    });
  });

  describe('cycle management', () => {
    it('should create fresh state when no existing state', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(undefined);

      const result = await TrackBudgetAllocator.getSummary();
      expect(result.cycleId).toBeDefined();
      expect(result.totalBudgetUsd).toBe(10.0);
      expect(ConfigManager.saveRawConfig).toHaveBeenCalled();
    });

    it('should create fresh state when cycle expired', async () => {
      const expiredState = createFreshState();
      expiredState.expiresAt = Date.now() - 1000;
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(expiredState);

      const result = await TrackBudgetAllocator.getSummary();
      expect(result.spendHistory).toEqual([]);
      expect(ConfigManager.saveRawConfig).toHaveBeenCalled();
    });

    it('should reset cycle', async () => {
      await TrackBudgetAllocator.resetCycle();
      expect(ConfigManager.saveRawConfig).toHaveBeenCalledWith(
        'track_evolution_budget',
        expect.objectContaining({
          spendHistory: [],
          allocations: expect.any(Object),
        })
      );
    });
  });

  describe('rebalanceBasedOnPerformance', () => {
    it('should not produce negative remaining budget', async () => {
      const state = createFreshState();
      state.allocations[EvolutionTrack.REFACTORING] = { allocatedUsd: 1.0, spentUsd: 0.9 };
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(state);

      const perf = new Map([
        [EvolutionTrack.REFACTORING, { successRate: 0.2, utilizationRate: 0.9 }],
        [EvolutionTrack.SECURITY, { successRate: 0.9, utilizationRate: 0.85 }],
      ]);

      await TrackBudgetAllocator.rebalanceBasedOnPerformance(perf);

      const saveCall = vi.mocked(ConfigManager.saveRawConfig).mock.calls[0];
      const savedState = saveCall?.[1] as {
        allocations: Record<string, { allocatedUsd: number; spentUsd: number }>;
      };
      expect(
        savedState.allocations[EvolutionTrack.REFACTORING].allocatedUsd
      ).toBeGreaterThanOrEqual(savedState.allocations[EvolutionTrack.REFACTORING].spentUsd);
    });

    it('should not save when no rebalancing needed', async () => {
      const perf = new Map([
        [EvolutionTrack.SECURITY, { successRate: 0.8, utilizationRate: 0.3 }],
        [EvolutionTrack.FEATURE, { successRate: 0.8, utilizationRate: 0.3 }],
      ]);

      await TrackBudgetAllocator.rebalanceBasedOnPerformance(perf);
      // No underperforming tracks, so no save should happen
      expect(ConfigManager.saveRawConfig).not.toHaveBeenCalled();
    });
  });

  describe('getTotalRemaining and getTotalSpent', () => {
    it('should calculate totals correctly', async () => {
      const remaining = await TrackBudgetAllocator.getTotalRemaining();
      expect(remaining).toBe(10.0);

      const spent = await TrackBudgetAllocator.getTotalSpent();
      expect(spent).toBe(0);
    });
  });
});
