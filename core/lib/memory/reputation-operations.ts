/**
 * Reputation Operations Module
 *
 * Manages agent reputation data for swarm-aware routing decisions.
 * Tracks rolling 7-day performance metrics per agent: tasks completed/failed,
 * average latency, success rate, and last active timestamp.
 *
 * These functions operate on a BaseMemoryProvider instance.
 */

import { logger } from '../logger';
import { TIME, MEMORY_KEYS } from '../constants';
import type { BaseMemoryProvider } from './base';
import type { AgentReputation } from '../types/reputation';

/**
 * Rolling window for reputation metrics (7 days in milliseconds).
 */
const REPUTATION_WINDOW_MS = 7 * TIME.MS_PER_DAY;

/**
 * Resolves the DynamoDB partition key for a reputation record.
 */
function reputationKey(agentId: string): string {
  return `${MEMORY_KEYS.REPUTATION_PREFIX}${agentId}`;
}

/**
 * Retrieves the current reputation for an agent.
 *
 * @param base - The base memory provider instance.
 * @param agentId - The agent to look up.
 * @returns The agent's reputation, or null if no record exists.
 */
export async function getReputation(
  base: BaseMemoryProvider,
  agentId: string
): Promise<AgentReputation | null> {
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts = :zero',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': reputationKey(agentId),
        ':zero': 0,
      },
    });

    if (items.length === 0) return null;

    const item = items[0];
    const rep: AgentReputation = {
      agentId: item.agentId as string,
      tasksCompleted: (item.tasksCompleted as number) ?? 0,
      tasksFailed: (item.tasksFailed as number) ?? 0,
      totalLatencyMs: (item.totalLatencyMs as number) ?? 0,
      successRate: (item.successRate as number) ?? 0,
      avgLatencyMs: (item.avgLatencyMs as number) ?? 0,
      lastActive: (item.lastActive as number) ?? 0,
      windowStart: (item.windowStart as number) ?? Date.now(),
      expiresAt: (item.expiresAt as number) ?? 0,
      createdAt: (item.createdAt as number) ?? Date.now(),
      totalTasks: ((item.tasksCompleted as number) ?? 0) + ((item.tasksFailed as number) ?? 0),
      rollingWindow: 7,
      score: 0,
    };
    rep.score = computeReputationScore(rep);
    return rep;
  } catch (error) {
    logger.error(`Failed to get reputation for ${agentId}:`, error);
    return null;
  }
}

export type UpdateReputationResult = { success: true } | { success: false; error: string };

/**
 * Updates agent reputation on task completion or failure.
 * Uses atomic DynamoDB operations to prevent race conditions.
 * Derived values (successRate, avgLatencyMs) are computed on read in getReputation()
 * to avoid race conditions from read-modify-write patterns.
 * Window expiry is handled by DynamoDB TTL - stale records auto-expire.
 *
 * @param base - The base memory provider instance.
 * @param agentId - The agent whose reputation to update.
 * @param success - Whether the task succeeded.
 * @param latencyMs - Duration of the task in milliseconds.
 */
export async function updateReputation(
  base: BaseMemoryProvider,
  agentId: string,
  success: boolean,
  latencyMs: number = 0
): Promise<UpdateReputationResult> {
  const now = Date.now();
  const pk = reputationKey(agentId);

  try {
    await base.updateItem({
      Key: { userId: pk, timestamp: 0 },
      UpdateExpression:
        'SET type = :type, ' +
        'agentId = :agentId, ' +
        'lastActive = :now, ' +
        'expiresAt = :exp, ' +
        'tasksCompleted = if_not_exists(tasksCompleted, :zero) + :completed, ' +
        'tasksFailed = if_not_exists(tasksFailed, :zero) + :failed, ' +
        'totalLatencyMs = if_not_exists(totalLatencyMs, :zero) + :latency, ' +
        'windowStart = if_not_exists(windowStart, :now), ' +
        'createdAt = if_not_exists(createdAt, :now)',
      ExpressionAttributeValues: {
        ':type': 'REPUTATION',
        ':agentId': agentId,
        ':now': now,
        ':exp': Math.floor((now + REPUTATION_WINDOW_MS) / 1000),
        ':zero': 0,
        ':completed': success ? 1 : 0,
        ':failed': success ? 0 : 1,
        ':latency': success ? latencyMs : 0,
      },
    });

    logger.info(`[Reputation] Updated ${agentId}: success=${success}, tasksUpdated`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to update reputation for ${agentId}:`, error);
    return { success: false, error: message };
  }
}

/**
 * Retrieves reputations for multiple agents in a single batch.
 *
 * @param base - The base memory provider instance.
 * @param agentIds - The agent IDs to look up.
 * @returns A map of agentId to AgentReputation (missing entries are excluded).
 */
export async function getReputations(
  base: BaseMemoryProvider,
  agentIds: string[]
): Promise<Map<string, AgentReputation>> {
  const results = new Map<string, AgentReputation>();
  const promises = agentIds.map(async (id) => {
    const rep = await getReputation(base, id);
    if (rep) results.set(id, rep);
  });
  await Promise.all(promises);
  return results;
}

/**
 * Computes a composite reputation score (0-1) suitable for routing decisions.
 * Weights: 60% success rate, 25% latency (inverted), 15% recency.
 *
 * @param reputation - The agent's reputation data.
 * @returns A score from 0 (worst) to 1 (best).
 */
export function computeReputationScore(reputation: AgentReputation): number {
  const now = Date.now();

  // Success rate component (0-1)
  const successComponent = reputation.successRate;

  // Latency component: normalized to 0-1 (lower is better, 5s baseline)
  const baselineLatency = 5000;
  const latencyComponent = Math.max(0, 1 - reputation.avgLatencyMs / (baselineLatency * 3));

  // Recency component: decays over 24 hours
  const hoursSinceActive = (now - reputation.lastActive) / TIME.MS_PER_HOUR;
  const recencyComponent = Math.max(0, 1 - hoursSinceActive / 24);

  return successComponent * 0.6 + latencyComponent * 0.25 + recencyComponent * 0.15;
}
