/**
 * Code Growth Tracking Module
 *
 * Tracks code base growth and triggers audits when thresholds are exceeded.
 */

import { logger } from '../../lib/logger';
import { getConfigValue } from '../../lib/config';
import { emitEvent } from '../../lib/utils/bus';
import { AgentType, EventType } from '../../lib/types/agent';

export interface CodeGrowthMetrics {
  previousLOC: number;
  currentLOC: number;
  growthPercentage: number;
  timestamp: number;
}

const CODE_METRICS_KEY = 'system:code_metrics';

export async function getCodeMetrics(memory: {
  get(key: string): Promise<CodeGrowthMetrics | null>;
  set(key: string, value: unknown): Promise<void>;
}): Promise<CodeGrowthMetrics | null> {
  try {
    return await memory.get(CODE_METRICS_KEY);
  } catch (e) {
    logger.warn('[CodeGrowth] Failed to retrieve code metrics:', e);
    return null;
  }
}

export async function saveCodeMetrics(
  memory: { set(key: string, value: unknown): Promise<void> },
  metrics: CodeGrowthMetrics
): Promise<void> {
  try {
    await memory.set(CODE_METRICS_KEY, metrics);
  } catch (e) {
    logger.warn('[CodeGrowth] Failed to save code metrics:', e);
  }
}

export async function calculateCodeGrowth(
  memory: {
    get(key: string): Promise<CodeGrowthMetrics | null>;
    set(key: string, value: unknown): Promise<void>;
  },
  currentLOC: number
): Promise<{ shouldTriggerAudit: boolean; metrics: CodeGrowthMetrics }> {
  const threshold = getConfigValue('AUDIT_CODE_GROWTH_THRESHOLD');
  const existingMetrics = await getCodeMetrics(memory);

  const metrics: CodeGrowthMetrics = {
    previousLOC: existingMetrics?.currentLOC || currentLOC,
    currentLOC,
    growthPercentage: 0,
    timestamp: Date.now(),
  };

  if (metrics.previousLOC > 0) {
    metrics.growthPercentage = (currentLOC - metrics.previousLOC) / metrics.previousLOC;
  }

  const shouldTriggerAudit = metrics.growthPercentage > threshold;

  if (shouldTriggerAudit) {
    logger.info(
      `[CodeGrowth] Threshold exceeded: ${(metrics.growthPercentage * 100).toFixed(2)}% > ${(threshold * 100).toFixed(0)}%`
    );
  }

  await saveCodeMetrics(memory, metrics);

  return { shouldTriggerAudit, metrics };
}

export async function emitAuditEvent(growthMetrics: CodeGrowthMetrics): Promise<void> {
  try {
    await emitEvent(AgentType.STRATEGIC_PLANNER, EventType.SYSTEM_AUDIT_TRIGGER, {
      triggerType: 'CODE_GROWTH',
      metrics: growthMetrics,
      timestamp: Date.now(),
    });
    logger.info('[CodeGrowth] Audit event emitted due to code growth threshold');
  } catch (e) {
    logger.error('[CodeGrowth] Failed to emit audit event:', e);
  }
}
