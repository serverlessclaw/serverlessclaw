import { logger } from '../../logger';
import { MEMORY_KEYS, TIME } from '../../constants';
import { BaseMemoryProvider } from '../../memory/base';
import { AggregatedMetrics, MetricsWindow, MemoryHealthAnalysis } from '../../types/metrics';

/**
 * Analyzes health trends over time.
 */
export class HealthTrendAnalyzer {
  private base: BaseMemoryProvider;

  constructor(base: BaseMemoryProvider) {
    this.base = base;
  }

  /**
   * Get aggregated metrics for an agent over a time window.
   */
  async getAggregatedMetrics(
    agentId: string,
    window: MetricsWindow,
    windowStart: number,
    windowEnd: number,
    workspaceId?: string
  ): Promise<AggregatedMetrics> {
    const prefix = workspaceId ? `WS#${workspaceId}#` : '';
    const items = await this.base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${prefix}${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${agentId}`,
        ':start': windowStart,
        ':end': windowEnd,
      },
    });

    let totalTasks = 0;
    let completedTasks = 0;
    let totalLatency = 0;
    let totalTokens = 0;
    let coherenceSum = 0;
    let coherenceCount = 0;
    let memoryHits = 0;
    let memoryMisses = 0;
    let errors = 0;
    let totalReasoningSteps = 0;
    let totalPivots = 0;
    let totalClarifications = 0;
    let totalSelfCorrections = 0;

    for (const item of items) {
      const name = item.metricName as string;
      const value = item.value as number;

      switch (name) {
        case 'task_completed':
          totalTasks++;
          if (value === 1) completedTasks++;
          else errors++;
          break;
        case 'task_latency_ms':
          totalLatency += value;
          break;
        case 'tokens_used':
          totalTokens += value;
          break;
        case 'reasoning_coherence':
          coherenceSum += value;
          coherenceCount++;
          break;
        case 'reasoning_steps':
          totalReasoningSteps += value;
          break;
        case 'pivot':
          totalPivots += value;
          break;
        case 'clarification_request':
          totalClarifications += value;
          break;
        case 'self_correction':
          totalSelfCorrections += value;
          break;
        case 'memory_hit':
          memoryHits++;
          break;
        case 'memory_miss':
          memoryMisses++;
          break;
      }
    }

    const memoryTotal = memoryHits + memoryMisses;

    return {
      agentId,
      window,
      windowStart,
      windowEnd,
      taskCompletionRate: totalTasks > 0 ? completedTasks / totalTasks : 1,
      avgTaskLatencyMs: totalTasks > 0 ? totalLatency / totalTasks : 0,
      reasoningCoherence: coherenceCount > 0 ? coherenceSum / coherenceCount : 10,
      memoryHitRate: memoryTotal > 0 ? memoryHits / memoryTotal : 1,
      memoryMissRate: memoryTotal > 0 ? memoryMisses / memoryTotal : 0,
      tokenEfficiency: totalTokens > 0 ? (totalTasks / totalTokens) * 1000 : 0,
      errorRate: totalTasks > 0 ? errors / totalTasks : 0,
      totalTasks,
      totalTokens,
      totalReasoningSteps,
      totalPivots,
      totalClarifications,
      totalSelfCorrections,
    };
  }

  /**
   * Analyze memory health by scanning memory tiers.
   */
  async analyzeMemoryHealth(): Promise<MemoryHealthAnalysis> {
    const now = Date.now();
    const prefixes = [
      MEMORY_KEYS.CONVERSATION_PREFIX,
      MEMORY_KEYS.LESSON_PREFIX,
      MEMORY_KEYS.FACT_PREFIX,
      MEMORY_KEYS.SUMMARY_PREFIX,
    ];

    const allItems: Record<string, unknown>[] = [];
    const MAX_ITEMS_PER_PREFIX = 100;

    for (const prefix of prefixes) {
      try {
        const items = await this.base.scanByPrefix(prefix, { limit: MAX_ITEMS_PER_PREFIX });
        allItems.push(...items);
      } catch (error) {
        logger.warn('Failed to scan prefix for memory health analysis', { prefix, error });
      }
    }

    const totalItems = allItems.length;
    const itemsByTier: Record<string, number> = {};
    let totalAgeDays = 0;

    for (const item of allItems) {
      const userId = (item.userId as string) ?? '';
      // Fix: Skip potential WS#...# prefix to find the actual tier prefix (e.g. LESSON#)
      const match = userId.match(/(?:WS#.*?#)?([A-Z_]+#)/);
      const prefix = match?.[1] ?? 'UNKNOWN#';
      itemsByTier[prefix] = (itemsByTier[prefix] || 0) + 1;
      const ts = (item.timestamp as number) ?? 0;
      if (ts > 0) {
        totalAgeDays += (now - ts) / TIME.MS_PER_DAY;
      }
    }

    const avgAgeDays = totalItems > 0 ? totalAgeDays / totalItems : 0;
    const uniqueTiers = Object.keys(itemsByTier).length;
    const stalenessScore = Math.min(1, avgAgeDays / 90);
    const fragmentationScore = totalItems > 100 ? Math.min(1, uniqueTiers / 10) : 0;
    const lessonCount = itemsByTier[MEMORY_KEYS.LESSON_PREFIX] ?? 0;
    const coverageScore = totalItems > 0 ? Math.min(1, lessonCount / 10) : 0;

    const recommendations: string[] = [];
    if (totalItems > 0 && stalenessScore > 0.7)
      recommendations.push('Run memory pruning — many items are older than 60 days');
    if (totalItems > 100 && fragmentationScore > 0.8)
      recommendations.push('Memory is fragmented across many tiers — consider consolidation');
    if (totalItems > 5 && coverageScore < 0.3)
      recommendations.push('Low lesson coverage — agents may be repeating mistakes');

    return {
      totalItems,
      itemsByTier,
      avgAgeDays,
      stalenessScore,
      fragmentationScore,
      coverageScore,
      recommendations,
    };
  }
}
