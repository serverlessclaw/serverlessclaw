import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsightCategory } from '../../lib/types/index';
import type { IMemory } from '../../lib/types/index';
import { MEMORY_KEYS, TIME } from '../../lib/constants';

/**
 * Prompts Module Tests
 *
 * Tests for core/agents/strategic-planner/prompts.ts
 * Covers: buildTelemetry, shouldRunProactiveReview, buildReactivePrompt,
 *         buildProactiveReviewPrompt, fetchStaleMemoryContext
 */

// ============================================================================
// Mock Setup
// ============================================================================

function createMockMemory(overrides: Partial<IMemory> = {}): IMemory {
  return {
    getDistilledMemory: vi.fn().mockResolvedValue('0'),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    getAllGaps: vi.fn().mockResolvedValue([]),
    searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    archiveStaleGaps: vi.fn().mockResolvedValue(0),
    getLowUtilizationMemory: vi.fn().mockResolvedValue([]),
    getFailedPlans: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    getGlobalLessons: vi.fn().mockResolvedValue([]),
    addLesson: vi.fn().mockResolvedValue(undefined),
    addGlobalLesson: vi.fn().mockResolvedValue(0),
    recordFailurePattern: vi.fn().mockResolvedValue(0),
    refineMemory: vi.fn().mockResolvedValue(undefined),
    getLessons: vi.fn().mockResolvedValue([]),
    setGap: vi.fn().mockResolvedValue(undefined),
    updateGapStatus: vi.fn().mockResolvedValue(undefined),
    incrementGapAttemptCount: vi.fn().mockResolvedValue(1),
    acquireGapLock: vi.fn().mockResolvedValue(true),
    releaseGapLock: vi.fn().mockResolvedValue(undefined),
    getGapLock: vi.fn().mockResolvedValue(null),
    updateGapMetadata: vi.fn().mockResolvedValue(undefined),
    recordFailedPlan: vi.fn().mockResolvedValue(0),
    addMemory: vi.fn().mockResolvedValue(0),
    updateInsightMetadata: vi.fn().mockResolvedValue(undefined),
    listByPrefix: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue(undefined),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    listConversations: vi.fn().mockResolvedValue([]),
    saveConversationMeta: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    getSummary: vi.fn().mockResolvedValue(null),
    updateSummary: vi.fn().mockResolvedValue(undefined),
    saveClarificationRequest: vi.fn().mockResolvedValue(undefined),
    getClarificationRequest: vi.fn().mockResolvedValue(null),
    updateClarificationStatus: vi.fn().mockResolvedValue(undefined),
    saveEscalationState: vi.fn().mockResolvedValue(undefined),
    getEscalationState: vi.fn().mockResolvedValue(null),
    findExpiredClarifications: vi.fn().mockResolvedValue([]),
    incrementClarificationRetry: vi.fn().mockResolvedValue(0),
    getCollaboration: vi.fn().mockResolvedValue(null),
    checkCollaborationAccess: vi.fn().mockResolvedValue(true),
    closeCollaboration: vi.fn().mockResolvedValue(undefined),
    createCollaboration: vi.fn().mockResolvedValue({} as any),
    listCollaborationsForParticipant: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IMemory;
}

vi.mock('../../lib/registry/index', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../tools/index', () => ({
  TOOLS: { toolA: {}, toolB: {} },
}));

vi.mock('../../lib/metrics/token-usage', () => ({
  TokenTracker: {
    getToolRollupRange: vi.fn().mockResolvedValue([]),
  },
}));

// ============================================================================
// Tests: buildTelemetry
// ============================================================================

describe('buildTelemetry', () => {
  it('should return formatted telemetry string with tools list', async () => {
    const { buildTelemetry } = await import('./prompts');
    const result = buildTelemetry('tool1, tool2, tool3');

    expect(result).toContain('[SYSTEM_TELEMETRY]');
    expect(result).toContain('ACTIVE_AGENTS');
    expect(result).toContain('main, coder, strategic-planner');
    expect(result).toContain('AVAILABLE_TOOLS');
    expect(result).toContain('tool1, tool2, tool3');
  });

  it('should handle empty tools list', async () => {
    const { buildTelemetry } = await import('./prompts');
    const result = buildTelemetry('');

    expect(result).toContain('[SYSTEM_TELEMETRY]');
    expect(result).toContain('AVAILABLE_TOOLS');
  });
});

// ============================================================================
// Tests: shouldRunProactiveReview
// ============================================================================

describe('shouldRunProactiveReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should always run for scheduled reviews even when recent', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(Date.now().toString()),
      getAllGaps: vi.fn().mockResolvedValue([
        {
          id: 'gap-1',
          content: 'test gap',
          metadata: { impact: 5 } as any,
          timestamp: Date.now(),
        },
      ]),
    });

    const result = await shouldRunProactiveReview(memory, true, 'user-1', 48, 1);

    expect(result.shouldRun).toBe(true);
  });

  it('should skip proactive review when too recent (within frequency/2 window)', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const now = Date.now();
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(now.toString()),
    });

    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('SKIPPED_TOO_RECENT');
  });

  it('should skip when insufficient gaps and no improvements', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const oldTimestamp = (Date.now() - 48 * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND).toString();
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(oldTimestamp),
      getAllGaps: vi.fn().mockResolvedValue([]),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    });

    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_GAPS_OR_OPTIMIZATIONS');
  });

  it('should run when enough gaps exist', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const oldTimestamp = (Date.now() - 48 * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND).toString();
    const gaps = Array.from({ length: 5 }, (_, i) => ({
      id: `gap-${i}`,
      content: `gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(oldTimestamp),
      getAllGaps: vi.fn().mockResolvedValue(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    });

    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(true);
  });

  it('should run when improvements exist even if gaps are below minimum', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const oldTimestamp = (Date.now() - 48 * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND).toString();
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(oldTimestamp),
      getAllGaps: vi.fn().mockResolvedValue([]),
      searchInsights: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'imp-1',
            content: 'improvement',
            metadata: { impact: 7 } as any,
            timestamp: Date.now(),
          },
        ],
      }),
    });

    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(true);
  });

  it('should default to shouldRun: true on memory error', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should handle getDistilledMemory returning null', async () => {
    const { shouldRunProactiveReview } = await import('./prompts');
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(null),
      getAllGaps: vi.fn().mockResolvedValue([
        {
          id: 'gap-1',
          content: 'gap',
          metadata: { impact: 5 } as any,
          timestamp: Date.now(),
        },
      ]),
    });

    // null parsed as 0, so now - 0 is large, will pass time check
    // but minGaps=5 and we only have 1 gap, and no improvements => INSUFFICIENT
    const result = await shouldRunProactiveReview(memory, false, 'user-1', 48, 5);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_GAPS_OR_OPTIMIZATIONS');
  });
});

// ============================================================================
// Tests: buildReactivePrompt
// ============================================================================

describe('buildReactivePrompt', () => {
  it('should build prompt with gap context when gapId is present', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      gapId: 'GAP#1001',
      task: 'Add Slack integration',
      userId: 'user-1',
      metadata: {
        impact: 8,
        urgency: 7,
        risk: 3,
        priority: 7,
        confidence: 9,
      },
    };

    const result = buildReactivePrompt(payload, 'test-telemetry');

    expect(result).toContain('CAPABILITY GAP IDENTIFIED');
    expect(result).toContain('Add Slack integration');
    expect(result).toContain('EVOLUTIONARY_SIGNALS');
    expect(result).toContain('IMPACT: 8/10');
    expect(result).toContain('URGENCY: 7/10');
    expect(result).toContain('RISK: 3/10');
    expect(result).toContain('test-telemetry');
    expect(result).toContain('user-1');
    expect(result).toContain('STRATEGIC_PLAN');
  });

  it('should build prompt with architectural context when gapId is absent', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      task: 'Review architecture',
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'test-telemetry');

    expect(result).toContain('ARCHITECTURAL TASK/INQUIRY');
    expect(result).toContain('Review architecture');
    expect(result).toContain('test-telemetry');
    expect(result).not.toContain('CAPABILITY GAP IDENTIFIED');
  });

  it('should use details field as fallback when task is missing', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      details: 'Fallback task description',
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'telemetry');

    expect(result).toContain('Fallback task description');
  });

  it('should default to "Strategic Review" when neither task nor details exist', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'telemetry');

    expect(result).toContain('Strategic Review');
  });

  it('should include failure patterns when provided', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      task: 'Fix bug',
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'telemetry', [
      { content: 'Do not use deprecated API' },
      { content: 'Avoid infinite loops' },
    ]);

    expect(result).toContain('KNOWN_FAILURE_PATTERNS');
    expect(result).toContain('Do not use deprecated API');
    expect(result).toContain('Avoid infinite loops');
  });

  it('should not include failure patterns section when empty', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      task: 'Fix bug',
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'telemetry', []);

    expect(result).not.toContain('[KNOWN_FAILURE_PATTERNS]');
  });

  it('should not include signals section when metadata is absent', async () => {
    const { buildReactivePrompt } = await import('./prompts');
    const payload = {
      task: 'Some task',
      userId: 'user-1',
    };

    const result = buildReactivePrompt(payload, 'telemetry');

    expect(result).not.toContain('EVOLUTIONARY_SIGNALS');
  });
});

// ============================================================================
// Tests: fetchStaleMemoryContext
// ============================================================================

describe('fetchStaleMemoryContext', () => {
  it('should return formatted stale memory items', async () => {
    const { fetchStaleMemoryContext } = await import('./prompts');
    const memory = createMockMemory({
      getLowUtilizationMemory: vi.fn().mockResolvedValue([
        {
          userId: 'item-1',
          timestamp: 1700000000,
          content: 'old content',
          metadata: { hitCount: 1, lastAccessed: 1700000000 },
        },
      ]),
    });

    const result = await fetchStaleMemoryContext(memory);

    expect(result).toContain('LOW_UTILIZATION_MEMORY');
    expect(result).toContain('item-1');
    expect(result).toContain('old content');
  });

  it('should return empty string when no stale items', async () => {
    const { fetchStaleMemoryContext } = await import('./prompts');
    const memory = createMockMemory({
      getLowUtilizationMemory: vi.fn().mockResolvedValue([]),
    });

    const result = await fetchStaleMemoryContext(memory);

    expect(result).toBe('');
  });

  it('should return empty string on memory error', async () => {
    const { fetchStaleMemoryContext } = await import('./prompts');
    const memory = createMockMemory({
      getLowUtilizationMemory: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await fetchStaleMemoryContext(memory);

    expect(result).toBe('');
  });

  it('should return empty string when null is returned', async () => {
    const { fetchStaleMemoryContext } = await import('./prompts');
    const memory = createMockMemory({
      getLowUtilizationMemory: vi.fn().mockResolvedValue(null),
    });

    const result = await fetchStaleMemoryContext(memory);

    expect(result).toBe('');
  });
});

// ============================================================================
// Tests: buildProactiveReviewPrompt
// ============================================================================

describe('buildProactiveReviewPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return shouldRun: false when proactive review is too recent', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(Date.now().toString()),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', false);

    expect(result.shouldRun).toBe(false);
    expect(result.prompt).toBe('');
  });

  it('should return shouldRun: false when no gaps exist after review check passes', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const oldTimestamp = (Date.now() - 48 * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND).toString();
    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `gap-${i}`,
      content: `gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));

    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue(oldTimestamp),
      // First call (shouldRunProactiveReview) returns gaps, second (prompt building) returns empty
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce([]),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(result.shouldRun).toBe(false);
    expect(result.status).toBe('NO_GAPS');
  });

  it('should build full prompt with gaps and improvements for scheduled review', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gaps = [
      {
        id: 'gap-1',
        content: 'Missing error handling',
        metadata: { impact: 8 } as any,
        timestamp: Date.now(),
      },
      {
        id: 'gap-2',
        content: 'No retry logic',
        metadata: { impact: 6 } as any,
        timestamp: Date.now(),
      },
    ];
    const improvements = [
      {
        id: 'imp-1',
        content: 'Add caching layer',
        metadata: { impact: 7, category: InsightCategory.SYSTEM_IMPROVEMENT } as any,
        timestamp: Date.now(),
      },
    ];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValue(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: improvements }),
      getFailedPlans: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'my-telemetry', true, [
      { content: 'Avoid using sync IO' },
    ]);

    expect(result.shouldRun).toBe(true);
    expect(result.prompt).toContain('PROACTIVE_STRATEGIC_REVIEW');
    expect(result.prompt).toContain('Missing error handling');
    expect(result.prompt).toContain('No retry logic');
    expect(result.prompt).toContain('Impact: 8/10');
    expect(result.prompt).toContain('Impact: 6/10');
    expect(result.prompt).toContain('Add caching layer');
    expect(result.prompt).toContain('my-telemetry');
    expect(result.prompt).toContain('Avoid using sync IO');
    expect(result.prompt).toContain('STRATEGIC_PLAN');
  });

  it('should include failed plans anti-patterns in prompt', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `review-gap-${i}`,
      content: `review gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));
    const gaps = [
      {
        id: 'gap-1',
        content: 'Missing tests',
        metadata: { impact: 5 } as any,
        timestamp: Date.now(),
      },
    ];
    const failedPlans = [
      {
        id: 'fp-1',
        content: JSON.stringify({
          gapIds: ['GAP#1'],
          planSummary: 'Use jest',
          failureReason: 'Incompatible with vitest',
        }),
        metadata: {} as any,
        timestamp: Date.now(),
      },
    ];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getFailedPlans: vi.fn().mockResolvedValue(failedPlans),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(result.shouldRun).toBe(true);
    expect(result.prompt).toContain('FAILED_PLANS_ANTI_PATTERNS');
    expect(result.prompt).toContain('GAP#1');
    expect(result.prompt).toContain('Incompatible with vitest');
  });

  it('should call updateDistilledMemory with current timestamp on success', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `review-gap-${i}`,
      content: `review gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));
    const gaps = [
      {
        id: 'gap-1',
        content: 'gap',
        metadata: { impact: 5 } as any,
        timestamp: Date.now(),
      },
    ];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getFailedPlans: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(memory.updateDistilledMemory).toHaveBeenCalledWith(
      `${MEMORY_KEYS.STRATEGIC_REVIEW}#user-1`,
      expect.any(String)
    );
  });

  it('should include no improvements message when none exist', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `review-gap-${i}`,
      content: `review gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));
    const gaps = [
      {
        id: 'gap-1',
        content: 'gap',
        metadata: { impact: 5 } as any,
        timestamp: Date.now(),
      },
    ];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getFailedPlans: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(result.prompt).toContain('No specific improvements logged yet');
  });

  it('should include only top 3 gaps by impact and show backlog summary for remaining gaps', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gaps = [
      {
        id: 'gap-1',
        content: 'gap-impact-1',
        metadata: { impact: 1 } as any,
        timestamp: Date.now(),
      },
      {
        id: 'gap-2',
        content: 'gap-impact-8',
        metadata: { impact: 8 } as any,
        timestamp: Date.now(),
      },
      {
        id: 'gap-3',
        content: 'gap-impact-10',
        metadata: { impact: 10 } as any,
        timestamp: Date.now(),
      },
      {
        id: 'gap-4',
        content: 'gap-impact-5',
        metadata: { impact: 5 } as any,
        timestamp: Date.now(),
      },
      {
        id: 'gap-5',
        content: 'gap-impact-9',
        metadata: { impact: 9 } as any,
        timestamp: Date.now(),
      },
    ];

    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `review-gap-${i}`,
      content: `review gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getFailedPlans: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(result.prompt).toContain('gap-impact-10');
    expect(result.prompt).toContain('gap-impact-9');
    expect(result.prompt).toContain('gap-impact-8');
    expect(result.prompt).not.toContain('gap-impact-5');
    expect(result.prompt).not.toContain('- [Impact: 1/10] gap-impact-1');
    expect(result.prompt).toContain('[BACKLOG_SUMMARY]');
    expect(result.prompt).toContain('There are 2 additional open gaps in the backlog');
  });

  it('should omit backlog summary when there are no remaining gaps beyond top 3', async () => {
    vi.resetModules();
    vi.mock('../../lib/registry/index', () => ({
      AgentRegistry: {
        getRawConfig: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { buildProactiveReviewPrompt } = await import('./prompts');
    const gaps = [
      { id: 'gap-1', content: 'one', metadata: { impact: 1 } as any, timestamp: Date.now() },
      { id: 'gap-2', content: 'two', metadata: { impact: 2 } as any, timestamp: Date.now() },
      { id: 'gap-3', content: 'three', metadata: { impact: 3 } as any, timestamp: Date.now() },
    ];

    const gapsForReview = Array.from({ length: 25 }, (_, i) => ({
      id: `review-gap-${i}`,
      content: `review gap ${i}`,
      metadata: { impact: 5 } as any,
      timestamp: Date.now(),
    }));

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValueOnce(gapsForReview).mockResolvedValueOnce(gaps),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getFailedPlans: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    });

    const result = await buildProactiveReviewPrompt(memory, 'user-1', 'telemetry', true);

    expect(result.prompt).not.toContain('[BACKLOG_SUMMARY]');
    expect(result.prompt).not.toContain('There are 0 additional open gaps in the backlog');
  });
});

// ============================================================================
// Tests: fetchToolUsageContext
// ============================================================================

describe('fetchToolUsageContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty string when no tools have usage data', async () => {
    vi.resetModules();
    vi.mock('../../tools/index', () => ({
      TOOLS: { toolA: {}, toolB: {} },
    }));
    vi.mock('../../lib/metrics/token-usage', () => ({
      TokenTracker: {
        getToolRollupRange: vi.fn().mockResolvedValue([]),
      },
    }));

    const { fetchToolUsageContext } = await import('./prompts');
    const result = await fetchToolUsageContext();

    expect(result).toBe('');
  });

  it('should return empty string on import error', async () => {
    vi.resetModules();
    vi.mock('../../tools/index', () => {
      throw new Error('Import failed');
    });

    const { fetchToolUsageContext } = await import('./prompts');
    const result = await fetchToolUsageContext();

    expect(result).toBe('');
  });
});
