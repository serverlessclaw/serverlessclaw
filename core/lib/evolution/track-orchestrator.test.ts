/**
 * @module TrackOrchestrator Tests
 * @description Comprehensive unit tests for multi-track evolution orchestration.
 * Covers: lifecycle, dispatch, completion, budget, dependencies, metrics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackOrchestrator, TrackState } from './track-orchestrator';
import { EvolutionTrack } from '../types/agent';
import type { BaseMemoryProvider } from '../memory/base';

// ─── Mocks ───────────────────────────────────────────────────────────────────────

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../memory/gap-operations', () => ({
  acquireGapLock: vi.fn(),
  releaseGapLock: vi.fn(),
  getGapLock: vi.fn(),
}));

vi.mock('../constants', () => ({
  MEMORY_KEYS: { TRACK_PREFIX: 'TRACK#' },
  TIME: { MS_PER_DAY: 86_400_000 },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function createMockBase(): BaseMemoryProvider {
  return {
    putItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
    queryItems: vi.fn().mockResolvedValue([]),
    updateItem: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    scanItems: vi.fn().mockResolvedValue([]),
  } as unknown as BaseMemoryProvider;
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('TrackOrchestrator', () => {
  let base: BaseMemoryProvider;
  let orchestrator: TrackOrchestrator;
  let acquireGapLock: ReturnType<typeof vi.fn>;
  let releaseGapLock: ReturnType<typeof vi.fn>;
  let getGapLock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    base = createMockBase();

    // Import mocked functions
    const gapOps = await import('../memory/gap-operations');
    acquireGapLock = vi.mocked(gapOps.acquireGapLock);
    releaseGapLock = vi.mocked(gapOps.releaseGapLock);
    getGapLock = vi.mocked(gapOps.getGapLock);

    orchestrator = new TrackOrchestrator(base);
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 1. TRACK LIFECYCLE
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Track Lifecycle', () => {
    it('should initialize all tracks as IDLE', () => {
      for (const track of Object.values(EvolutionTrack)) {
        const ctx = orchestrator.getTrackContext(track);
        expect(ctx?.state).toBe(TrackState.IDLE);
        expect(ctx?.activeGaps).toEqual([]);
        expect(ctx?.completedGaps).toEqual([]);
        expect(ctx?.failedGaps).toEqual([]);
      }
    });

    it('should activate an IDLE track', async () => {
      const result = await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      expect(result).toBe(true);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY);
      expect(ctx?.state).toBe(TrackState.ACTIVE);
      expect(ctx?.startedAt).toBeGreaterThan(0);
      expect(base.putItem).toHaveBeenCalled();
    });

    it('should return true when activating an already ACTIVE track', async () => {
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      const result = await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      expect(result).toBe(true);
    });

    it('should set track to THROTTLED when no budget available', async () => {
      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY)!;
      ctx.totalSpendUsd = ctx.budgetAllocatedUsd;

      const result = await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      expect(result).toBe(false);
      expect(ctx.state).toBe(TrackState.THROTTLED);
    });

    it('should return false when activating a non-existent track', async () => {
      const result = await orchestrator.activateTrack('NONEXISTENT' as EvolutionTrack);
      expect(result).toBe(false);
    });

    it('should pause an ACTIVE track', async () => {
      await orchestrator.activateTrack(EvolutionTrack.PERFORMANCE);
      await orchestrator.pauseTrack(EvolutionTrack.PERFORMANCE);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.PERFORMANCE);
      expect(ctx?.state).toBe(TrackState.PAUSED);
    });

    it('should resume a PAUSED track', async () => {
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);
      await orchestrator.pauseTrack(EvolutionTrack.FEATURE);
      const result = await orchestrator.resumeTrack(EvolutionTrack.FEATURE);

      expect(result).toBe(true);
      expect(orchestrator.getTrackContext(EvolutionTrack.FEATURE)?.state).toBe(TrackState.ACTIVE);
    });

    it('should return false when resuming a non-PAUSED track', async () => {
      const result = await orchestrator.resumeTrack(EvolutionTrack.SECURITY);
      expect(result).toBe(false);
    });

    it('should reset all tracks to IDLE', async () => {
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      await orchestrator.resetAllTracks();

      for (const track of Object.values(EvolutionTrack)) {
        const ctx = orchestrator.getTrackContext(track);
        expect(ctx?.state).toBe(TrackState.IDLE);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 2. GAP DISPATCH TO TRACKS
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Gap Dispatch to Tracks', () => {
    it('should allow dispatch when track is ACTIVE and conditions met', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      expect(result).toBe(true);
      expect(acquireGapLock).toHaveBeenCalledWith(base, 'gap-1', 'agent-1');
    });

    it('should allow dispatch when track is IDLE (auto-activates)', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);

      // IDLE tracks can receive dispatches - they auto-activate
      const canDispatch = await orchestrator.canDispatchToTrack(EvolutionTrack.SECURITY, 'gap-1');
      expect(canDispatch).toBe(true);

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      expect(result).toBe(true);
    });

    it('should reject dispatch when at concurrent limit', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);

      // SECURITY has max 2 concurrent gaps
      await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-2', 'agent-1');

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-3', 'agent-1');
      expect(result).toBe(false);
    });

    it('should reject dispatch when gap is locked by another agent', async () => {
      getGapLock.mockResolvedValue({ content: 'other-agent', expiresAt: Date.now() + 60000 });
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      expect(result).toBe(false);
      expect(acquireGapLock).not.toHaveBeenCalled();
    });

    it('should reject dispatch when budget is exhausted', async () => {
      getGapLock.mockResolvedValue(null);
      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY)!;
      ctx.totalSpendUsd = ctx.budgetAllocatedUsd;
      ctx.state = TrackState.ACTIVE;

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      expect(result).toBe(false);
    });

    it('should reject dispatch when lock acquisition fails', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(false);
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);

      const result = await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');
      expect(result).toBe(false);
    });

    it('should add gap to activeGaps on successful dispatch', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-10', 'agent-1');

      const ctx = orchestrator.getTrackContext(EvolutionTrack.FEATURE);
      expect(ctx?.activeGaps).toContain('gap-10');
      expect(ctx?.state).toBe(TrackState.ACTIVE);
    });

    it('should dispatch gaps to different tracks independently', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);

      await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      await orchestrator.activateTrack(EvolutionTrack.PERFORMANCE);

      await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-s1', 'agent-1');
      await orchestrator.dispatchGap(EvolutionTrack.PERFORMANCE, 'gap-p1', 'agent-1');

      expect(orchestrator.getTrackContext(EvolutionTrack.SECURITY)?.activeGaps).toContain('gap-s1');
      expect(orchestrator.getTrackContext(EvolutionTrack.PERFORMANCE)?.activeGaps).toContain(
        'gap-p1'
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 3. GAP COMPLETION TRACKING
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Gap Completion Tracking', () => {
    it('should move gap to completedGaps on success', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);
      await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1');

      await orchestrator.completeGap(EvolutionTrack.SECURITY, 'gap-1', 'agent-1', true, 0.5);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY);
      expect(ctx?.activeGaps).not.toContain('gap-1');
      expect(ctx?.completedGaps).toContain('gap-1');
      expect(ctx?.totalSpendUsd).toBe(0.5);
      expect(releaseGapLock).toHaveBeenCalledWith(base, 'gap-1', 'agent-1');
    });

    it('should move gap to failedGaps on failure', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.PERFORMANCE);
      await orchestrator.dispatchGap(EvolutionTrack.PERFORMANCE, 'gap-2', 'agent-1');

      await orchestrator.completeGap(EvolutionTrack.PERFORMANCE, 'gap-2', 'agent-1', false, 0.3);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.PERFORMANCE);
      expect(ctx?.activeGaps).not.toContain('gap-2');
      expect(ctx?.failedGaps).toContain('gap-2');
    });

    it('should update metrics on gap completion', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);
      await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1');

      await orchestrator.completeGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1', true, 1.0);

      const metrics = orchestrator.getTrackMetrics(EvolutionTrack.FEATURE);
      expect(metrics?.gapsProcessed).toBe(1);
      expect(metrics?.gapsSucceeded).toBe(1);
      expect(metrics?.gapsFailed).toBe(0);
      expect(metrics?.totalSpendUsd).toBe(1.0);
      expect(metrics?.successRate).toBe(1);
    });

    it('should calculate success rate correctly across multiple gaps', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      for (let i = 0; i < 3; i++) {
        await orchestrator.dispatchGap(EvolutionTrack.FEATURE, `gap-${i}`, 'agent-1');
        await orchestrator.completeGap(EvolutionTrack.FEATURE, `gap-${i}`, 'agent-1', i !== 1, 0.1);
      }

      const metrics = orchestrator.getTrackMetrics(EvolutionTrack.FEATURE);
      expect(metrics?.gapsProcessed).toBe(3);
      expect(metrics?.gapsSucceeded).toBe(2);
      expect(metrics?.gapsFailed).toBe(1);
      expect(metrics?.successRate).toBeCloseTo(2 / 3);
    });

    it('should mark track as COMPLETED when no more pending gaps and activeGaps empty', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.INFRASTRUCTURE);
      await orchestrator.dispatchGap(EvolutionTrack.INFRASTRUCTURE, 'gap-1', 'agent-1');

      (base.queryItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await orchestrator.completeGap(EvolutionTrack.INFRASTRUCTURE, 'gap-1', 'agent-1', true, 0.2);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.INFRASTRUCTURE);
      expect(ctx?.state).toBe(TrackState.COMPLETED);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 4. BUDGET AVAILABILITY CHECKS
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Budget Availability Checks', () => {
    it('should return true when spend is below allocated budget', () => {
      expect(orchestrator.hasBudgetAvailable(EvolutionTrack.SECURITY)).toBe(true);
    });

    it('should return false when spend equals or exceeds allocated budget', () => {
      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY)!;
      ctx.totalSpendUsd = ctx.budgetAllocatedUsd;
      expect(orchestrator.hasBudgetAvailable(EvolutionTrack.SECURITY)).toBe(false);
    });

    it('should allocate budget based on configured weights', () => {
      const maxBudget = 10.0;
      const weights = {
        [EvolutionTrack.SECURITY]: 0.3,
        [EvolutionTrack.PERFORMANCE]: 0.25,
        [EvolutionTrack.FEATURE]: 0.2,
        [EvolutionTrack.INFRASTRUCTURE]: 0.15,
        [EvolutionTrack.REFACTORING]: 0.1,
      };

      for (const track of Object.values(EvolutionTrack)) {
        const ctx = orchestrator.getTrackContext(track);
        expect(ctx?.budgetAllocatedUsd).toBe(maxBudget * weights[track]);
      }
    });

    it('should return false for non-existent track', () => {
      expect(orchestrator.hasBudgetAvailable('NONEXISTENT' as EvolutionTrack)).toBe(false);
    });

    it('should use custom budget config when provided', () => {
      const customOrchestrator = new TrackOrchestrator(base, {
        maxTotalBudgetUsd: 50.0,
        budgetWeights: {
          [EvolutionTrack.SECURITY]: 0.5,
          [EvolutionTrack.PERFORMANCE]: 0.5,
          [EvolutionTrack.FEATURE]: 0,
          [EvolutionTrack.INFRASTRUCTURE]: 0,
          [EvolutionTrack.REFACTORING]: 0,
        },
      });

      expect(customOrchestrator.getTrackContext(EvolutionTrack.SECURITY)?.budgetAllocatedUsd).toBe(
        25.0
      );
      expect(
        customOrchestrator.getTrackContext(EvolutionTrack.PERFORMANCE)?.budgetAllocatedUsd
      ).toBe(25.0);
    });

    it('should track cumulative spend across completions', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1');
      await orchestrator.completeGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1', true, 1.5);

      await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-2', 'agent-1');
      await orchestrator.completeGap(EvolutionTrack.FEATURE, 'gap-2', 'agent-1', true, 2.0);

      const ctx = orchestrator.getTrackContext(EvolutionTrack.FEATURE);
      expect(ctx?.totalSpendUsd).toBe(3.5);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 5. CROSS-TRACK DEPENDENCIES
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Cross-Track Dependencies', () => {
    it('should add a dependency between tracks', async () => {
      await orchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-dep-1',
        'Security fix required before feature deploy'
      );

      expect(base.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRACK_DEPENDENCY',
          sourceTrack: EvolutionTrack.SECURITY,
          targetTrack: EvolutionTrack.FEATURE,
          gapId: 'gap-dep-1',
          resolved: false,
        })
      );
    });

    it('should block dispatch when unresolved dependency exists', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      await orchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-blocked',
        'needs security patch first'
      );

      const result = await orchestrator.dispatchGap(
        EvolutionTrack.FEATURE,
        'gap-blocked',
        'agent-1'
      );
      expect(result).toBe(false);
    });

    it('should allow dispatch after dependency is resolved', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      await orchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-1',
        'needs security patch first'
      );
      await orchestrator.resolveDependency('gap-1', EvolutionTrack.SECURITY);

      const result = await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1');
      expect(result).toBe(true);
    });

    it('should resolve correct dependency when multiple exist', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);

      await orchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-a',
        'dep A'
      );
      await orchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-b',
        'dep B'
      );

      await orchestrator.resolveDependency('gap-a', EvolutionTrack.SECURITY);

      await orchestrator.activateTrack(EvolutionTrack.FEATURE);
      expect(await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-a', 'agent-1')).toBe(true);
    });

    it('should ignore resolveDependency for non-existent dependency', async () => {
      await orchestrator.resolveDependency('nonexistent-gap', EvolutionTrack.SECURITY);
    });

    it('should not check dependencies when feature is disabled', async () => {
      const customOrchestrator = new TrackOrchestrator(base, {
        enableCrossTrackDependencies: false,
      });

      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await customOrchestrator.activateTrack(EvolutionTrack.FEATURE);

      await customOrchestrator.addDependency(
        EvolutionTrack.SECURITY,
        EvolutionTrack.FEATURE,
        'gap-1',
        'should be ignored'
      );

      const result = await customOrchestrator.dispatchGap(
        EvolutionTrack.FEATURE,
        'gap-1',
        'agent-1'
      );
      expect(result).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // 6. TRACK CONTEXT AND METRICS RETRIEVAL
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Track Context and Metrics Retrieval', () => {
    it('should return track context for a valid track', () => {
      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY);
      expect(ctx).toBeDefined();
      expect(ctx?.track).toBe(EvolutionTrack.SECURITY);
      expect(ctx?.state).toBe(TrackState.IDLE);
    });

    it('should return undefined for invalid track', () => {
      const ctx = orchestrator.getTrackContext('INVALID' as EvolutionTrack);
      expect(ctx).toBeUndefined();
    });

    it('should return all track contexts', () => {
      const all = orchestrator.getAllTrackContexts();
      expect(all).toHaveLength(Object.values(EvolutionTrack).length);
      expect(all.map((c) => c.track)).toEqual(
        expect.arrayContaining(Object.values(EvolutionTrack))
      );
    });

    it('should return track metrics for a valid track', () => {
      const metrics = orchestrator.getTrackMetrics(EvolutionTrack.PERFORMANCE);
      expect(metrics).toBeDefined();
      expect(metrics?.track).toBe(EvolutionTrack.PERFORMANCE);
      expect(metrics?.gapsProcessed).toBe(0);
      expect(metrics?.successRate).toBe(1);
    });

    it('should return undefined for invalid track metrics', () => {
      const metrics = orchestrator.getTrackMetrics('INVALID' as EvolutionTrack);
      expect(metrics).toBeUndefined();
    });

    it('should return all track metrics', () => {
      const all = orchestrator.getAllTrackMetrics();
      expect(all).toHaveLength(Object.values(EvolutionTrack).length);
    });

    it('should reflect updated state after activation', async () => {
      await orchestrator.activateTrack(EvolutionTrack.REFACTORING);
      const ctx = orchestrator.getTrackContext(EvolutionTrack.REFACTORING);
      expect(ctx?.state).toBe(TrackState.ACTIVE);
      expect(ctx?.startedAt).toBeGreaterThan(0);
    });

    it('should update lastActivityAt on dispatch and completion', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.FEATURE);

      const ctxBefore = orchestrator.getTrackContext(EvolutionTrack.FEATURE)!;
      const activityBefore = ctxBefore.lastActivityAt;

      await orchestrator.dispatchGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1');
      const ctxAfterDispatch = orchestrator.getTrackContext(EvolutionTrack.FEATURE)!;
      expect(ctxAfterDispatch.lastActivityAt).toBeGreaterThanOrEqual(activityBefore);

      await orchestrator.completeGap(EvolutionTrack.FEATURE, 'gap-1', 'agent-1', true, 0);
      const ctxAfterComplete = orchestrator.getTrackContext(EvolutionTrack.FEATURE)!;
      expect(ctxAfterComplete.lastActivityAt).toBeGreaterThanOrEqual(
        ctxAfterDispatch.lastActivityAt
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // ADDITIONAL EDGE CASES
  // ════════════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('should handle completion of non-tracked gap gracefully', async () => {
      await orchestrator.completeGap(EvolutionTrack.SECURITY, 'ghost-gap', 'agent-1', true, 0);
      expect(releaseGapLock).toHaveBeenCalledWith(base, 'ghost-gap', 'agent-1');
    });

    it('should handle pauseTrack on non-existent track gracefully', async () => {
      await orchestrator.pauseTrack('NONEXISTENT' as EvolutionTrack);
    });

    it('should use default config when no overrides provided', () => {
      const ctx = orchestrator.getTrackContext(EvolutionTrack.SECURITY);
      expect(ctx?.budgetAllocatedUsd).toBe(3.0);
    });

    it('should persist state after dispatch', async () => {
      getGapLock.mockResolvedValue(null);
      acquireGapLock.mockResolvedValue(true);
      await orchestrator.activateTrack(EvolutionTrack.SECURITY);

      await orchestrator.dispatchGap(EvolutionTrack.SECURITY, 'gap-save', 'agent-1');

      const putCalls = (base.putItem as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
