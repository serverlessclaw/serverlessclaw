/**
 * Gap Operations Module
 *
 * Contains gap management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, InsightCategory } from '../types/memory';
import { GapStatus, EvolutionTrack } from '../types/agent';
import { logger } from '../logger';
import { RetentionManager } from './tiering';
import { LIMITS, TIME, MEMORY_KEYS } from '../constants';
import type { BaseMemoryProvider } from './base';
import { createMetadata, queryByTypeAndMap } from './utils';

/** Minimal interface for track operations — satisfied by BaseMemoryProvider and DynamoMemory. */
interface TrackStore {
  putItem(item: Record<string, unknown>): Promise<void>;
  queryItems(params: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

/**
 * Default gap lock TTL in milliseconds (30 minutes).
 * Prevents race conditions when multiple planners/coders work on the same gap.
 */
const GAP_LOCK_TTL_MS = 30 * 60 * 1000;

/**
 * Retrieves all capability gaps filtered by status.
 *
 * @param base - The base memory provider instance.
 * @param status - The gap status to filter by (default: OPEN).
 * @returns A promise resolving to an array of MemoryInsight objects representing gaps.
 * @since 2026-03-19
 */
export async function getAllGaps(
  base: BaseMemoryProvider,
  status: GapStatus = GapStatus.OPEN
): Promise<MemoryInsight[]> {
  return queryByTypeAndMap(base, 'GAP', InsightCategory.STRATEGIC_GAP, 100, '#status = :status', {
    ':status': status,
  });
}

/**
 * Archives stale gaps that have been open for longer than the specified days.
 * Returns the number of gaps archived.
 *
 * @param base - The base memory provider instance.
 * @param staleDays - The number of days after which a gap is considered stale.
 * @returns A promise resolving to the number of archived gaps.
 */
export async function archiveStaleGaps(
  base: BaseMemoryProvider,
  staleDays: number = LIMITS.STALE_GAP_DAYS
): Promise<number> {
  const cutoffTime = Date.now() - staleDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

  // Get all OPEN and PLANNED gaps
  const items = await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#tp = :type',
    FilterExpression: '#status IN (:open, :planned)',
    ExpressionAttributeNames: {
      '#tp': 'type',
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':type': 'GAP',
      ':status': GapStatus.OPEN,
      ':planned': GapStatus.PLANNED,
    },
  });

  const staleGaps = items.filter(
    (item) => item.timestamp && (item.timestamp as number) < cutoffTime
  );

  let archived = 0;
  for (const gap of staleGaps) {
    try {
      await base.updateItem({
        Key: {
          userId: gap.userId,
          timestamp: gap.timestamp,
        },
        UpdateExpression: 'SET #status = :archived, updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':archived': GapStatus.ARCHIVED,
          ':now': Date.now(),
        },
      });
      archived++;
      logger.info(`Archived stale gap: ${gap.userId}`);
    } catch (e: unknown) {
      logger.warn(`Failed to archive gap ${gap.userId}:`, e);
    }
  }

  if (archived > 0) {
    logger.info(`Archived ${archived} stale gaps older than ${staleDays} days`);
  }

  return archived;
}

/**
 * Records a new capability gap.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The unique identifier for the gap (usually a timestamp).
 * @param details - The textual description of the gap.
 * @param metadata - Optional insight metadata.
 * @returns A promise resolving when the gap is recorded.
 * @since 2026-03-19
 */
export async function setGap(
  base: BaseMemoryProvider,
  gapId: string,
  details: string,
  metadata?: InsightMetadata
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('GAP', '');
  const nId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
  const numericIdMatch = nId.match(/(\d+)$/);
  const normalizedId = numericIdMatch ? numericIdMatch[1] : nId;
  const parsedGapId = Number.parseInt(normalizedId, 10);
  const gapTimestamp = Number.isNaN(parsedGapId) ? Date.now() : parsedGapId;
  await base.putItem({
    userId: `GAP#${normalizedId}`,
    timestamp: gapTimestamp,
    createdAt: gapTimestamp,
    type,
    expiresAt,
    content: details,
    status: GapStatus.OPEN,
    metadata: createMetadata(metadata ?? { category: InsightCategory.STRATEGIC_GAP }, gapTimestamp),
  });
}

/**
 * Atomically increments the attempt counter on a capability gap and returns the new count.
 * Used by the self-healing loop to cap infinite reopen/redeploy cycles.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The unique identifier for the gap.
 * @returns A promise resolving to the new attempt count.
 * @since 2026-03-19
 */
export async function incrementGapAttemptCount(
  base: BaseMemoryProvider,
  gapId: string
): Promise<number> {
  // Normalize ID using same logic as setGap()
  const nId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
  const numericIdMatch = nId.match(/(\d+)$/);
  const normalizedId = numericIdMatch ? numericIdMatch[1] : nId;
  const parsedNumericId = Number.parseInt(normalizedId, 10);
  const gapTimestamp = Number.isNaN(parsedNumericId) ? 0 : parsedNumericId;

  try {
    const now = Date.now();
    const result = await base.updateItem({
      Key: {
        userId: `GAP#${normalizedId}`,
        timestamp: gapTimestamp,
      },
      UpdateExpression:
        'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now, lastAttemptTime = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((result as any).Attributes?.attemptCount as number) ?? 1;
  } catch {
    // Fallback: search across all gap statuses to find the item (same as updateGapStatus)
    logger.warn(`Primary key lookup failed for gap ${gapId}, searching all statuses...`);
    const allStatuses = Object.values(GapStatus);
    for (const s of allStatuses) {
      const gaps = await getAllGaps(base, s);
      const target = gaps.find((g) => {
        const gIdNorm = g.id.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
        const gIdMatch = gIdNorm.match(/(\d+)$/);
        const gIdFinal = gIdMatch ? gIdMatch[1] : gIdNorm;
        return gIdFinal === normalizedId;
      });
      if (target) {
        try {
          const now = Date.now();
          const result = await base.updateItem({
            Key: { userId: target.id, timestamp: target.timestamp },
            UpdateExpression:
              'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now, lastAttemptTime = :now',
            ExpressionAttributeValues: {
              ':zero': 0,
              ':one': 1,
              ':now': now,
            },
            ReturnValues: 'ALL_NEW',
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ((result as any).Attributes?.attemptCount as number) ?? 1;
        } catch (e) {
          logger.error(`Fallback update also failed for gap ${gapId}:`, e);
        }
      }
    }
    logger.error(`Gap ${gapId} not found in any status for attempt increment`);
    return 1;
  }
}

/**
 * Transitions a capability gap to a new status.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The unique identifier for the gap.
 * @param status - The new status to transition to.
 * @returns A promise resolving when the status is updated.
 * @since 2026-03-19
 */
export async function updateGapStatus(
  base: BaseMemoryProvider,
  gapId: string,
  status: GapStatus
): Promise<void> {
  // Normalize ID: remove any leading GAP# prefixes and intermediate garbage before the final ID
  // e.g., GAP#GAP#PROC#123 -> 123, GAP#GAP#MY_GAP -> MY_GAP
  const normalizedId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
  const numericIdMatch = normalizedId.match(/(\d+)$/);
  const numericId = numericIdMatch ? numericIdMatch[1] : normalizedId;
  const parsedNumericId = Number.parseInt(numericId, 10);
  const defaultTimestamp = Number.isNaN(parsedNumericId) ? 0 : parsedNumericId;
  const params: Record<string, unknown> = {
    Key: {
      userId: `GAP#${numericId}`,
      timestamp: defaultTimestamp,
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now',
    ConditionExpression: 'attribute_exists(userId)',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':now': Date.now(),
    },
  };

  if (status === GapStatus.DONE) {
    params.ConditionExpression = 'attribute_exists(userId) AND #status = :deployedStatus';
    (params.ExpressionAttributeValues as Record<string, unknown>)[':deployedStatus'] =
      GapStatus.DEPLOYED;
  }

  // Strategy 2: If primary key fails, search and retry exactly ONCE with specific timestamp
  if (Number.isNaN(parsedNumericId) || (params.Key as Record<string, unknown>)?.timestamp === 0) {
    const allStatuses = Object.values(GapStatus);
    let found = false;
    for (const s of allStatuses) {
      const gaps = await getAllGaps(base, s);
      const target = gaps.find((g) => {
        const gIdNorm = g.id.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
        const gIdMatch = gIdNorm.match(/(\d+)$/);
        const gIdFinal = gIdMatch ? gIdMatch[1] : gIdNorm;
        return gIdFinal === numericId;
      });
      if (target) {
        params.Key = { userId: target.id, timestamp: target.timestamp };

        found = true;
        break;
      }
    }
    if (!found) {
      logger.error(
        `Gap update aborted: ID ${gapId} not found in any status (searched for ${numericId}).`
      );
      return;
    }
  }

  try {
    await base.updateItem(params);
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      if (status === GapStatus.DONE) {
        logger.warn(
          `Gap update aborted: Cannot transition gap ${gapId} to DONE because it is not in DEPLOYED state.`
        );
        return;
      }
      logger.warn(
        `Gap update race condition or missing item: ${gapId}. Retrying with fresh lookup.`
      );
      // Final desperate attempted lookup to see if timestamp shifted
      const all = await getAllGaps(base);
      const retryTarget = all.find((g) => g.id === `GAP#${numericId}`);
      if (retryTarget) {
        params.Key = { userId: `GAP#${numericId}`, timestamp: retryTarget.timestamp };
        try {
          await base.updateItem(params);
        } catch (e) {
          logger.error(`Failed retry update gap ${gapId} status:`, e);
        }
      }
    } else {
      logger.error(`Error updating gap ${gapId} status:`, error);
    }
  }
}

// =============================================================================
// GAP #1 FIX: Conflict Detection — Gap-Level Locking
// =============================================================================

/**
 * Attempts to acquire a lock on a gap to prevent race conditions
 * when multiple planners or coders try to work on the same gap simultaneously.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The gap ID to lock.
 * @param agentId - The agent requesting the lock.
 * @param ttlMs - Lock time-to-live in milliseconds (default: 30 minutes).
 * @returns A promise resolving to true if the lock was acquired, false if already locked.
 */
export async function acquireGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  agentId: string,
  ttlMs: number = GAP_LOCK_TTL_MS
): Promise<boolean> {
  const lockKey = `GAP_LOCK#${gapId.replace(/^(GAP#)+/, '')}`;
  const now = Date.now();
  const expiresAt = Math.floor((now + ttlMs) / 1000); // DynamoDB TTL uses seconds

  try {
    // Atomic update to acquire lock if not exists or expired
    // We use timestamp: 0 for all locks to make deletion reliable
    await base.updateItem({
      Key: {
        userId: lockKey,
        timestamp: 0,
      },
      UpdateExpression:
        'SET #tp = :type, #content = :agentId, #status = :locked, expiresAt = :exp, acquiredAt = :now',
      ConditionExpression: 'attribute_not_exists(userId) OR expiresAt < :nowSec',
      ExpressionAttributeNames: {
        '#tp': 'type',
        '#content': 'content',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'GAP_LOCK',
        ':agentId': agentId,
        ':locked': 'LOCKED',
        ':exp': expiresAt,
        ':now': now,
        ':nowSec': Math.floor(now / 1000),
      },
    });
    logger.info(`Gap lock acquired: ${gapId} by ${agentId}`);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      logger.info(`Gap ${gapId} is already locked by another agent`);
      return false;
    }
    logger.error(`Failed to acquire gap lock for ${gapId}:`, error);
    return false;
  }
}

/**
 * Releases a gap lock after work is complete.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The gap ID to unlock.
 * @param agentId - The agent releasing the lock (must match the lock holder).
 */
export async function releaseGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  agentId: string
): Promise<void> {
  const lockKey = `GAP_LOCK#${gapId.replace(/^(GAP#)+/, '')}`;
  try {
    // Only delete if we are the owner
    await base.deleteItem({
      userId: lockKey,
      timestamp: 0,
      ConditionExpression: '#content = :agentId',
      ExpressionAttributeNames: {
        '#content': 'content',
      },
      ExpressionAttributeValues: {
        ':agentId': agentId,
      },
    });
    logger.info(`Gap lock released: ${gapId} by ${agentId}`);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
      logger.warn(`Failed to release gap lock for ${gapId}: not owned by ${agentId}`);
    } else {
      logger.warn(`Failed to release gap lock for ${gapId}:`, e);
    }
  }
}

/**
 * Checks if a gap is currently locked and returns the lock holder info.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The gap ID to check.
 * @returns The lock record if active, or null if unlocked.
 */
export async function getGapLock(
  base: BaseMemoryProvider,
  gapId: string
): Promise<{ content: string; expiresAt: number } | null> {
  const lockKey = `GAP_LOCK#${gapId.replace(/^(GAP#)+/, '')}`;
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :lockKey AND #ts = :zero',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':lockKey': lockKey,
        ':zero': 0,
      },
    });
    if (items.length === 0) return null;
    const lock = items[0];
    const nowSec = Math.floor(Date.now() / 1000);
    if ((lock.expiresAt as number) < nowSec) return null;

    return {
      content: lock.content as string,
      expiresAt: (lock.expiresAt as number) ?? 0,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Gap-Track Assignment (Multi-Track Evolution)
// ============================================================================

const TRACK_DEFAULTS: Record<string, { maxConcurrentGaps: number; priority: number }> = {
  [EvolutionTrack.SECURITY]: { maxConcurrentGaps: 2, priority: 1 },
  [EvolutionTrack.PERFORMANCE]: { maxConcurrentGaps: 3, priority: 2 },
  [EvolutionTrack.FEATURE]: { maxConcurrentGaps: 3, priority: 3 },
  [EvolutionTrack.INFRASTRUCTURE]: { maxConcurrentGaps: 2, priority: 4 },
  [EvolutionTrack.REFACTORING]: { maxConcurrentGaps: 2, priority: 5 },
};

/**
 * Assigns a gap to an evolution track.
 */
export async function assignGapToTrack(
  base: TrackStore,
  gapId: string,
  track: EvolutionTrack,
  priority?: number
): Promise<void> {
  const defaults = TRACK_DEFAULTS[track] ?? { maxConcurrentGaps: 3, priority: 5 };
  const { expiresAt } = await RetentionManager.getExpiresAt('GAP', '');
  const normalizedId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');

  await base.putItem({
    userId: `${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`,
    timestamp: 0,
    type: 'TRACK_ASSIGNMENT',
    gapId: normalizedId,
    track,
    priority: priority ?? defaults.priority,
    assignedAt: Date.now(),
    createdAt: Date.now(),
    expiresAt,
  });

  logger.info(`[GapTrack] Assigned gap ${normalizedId} to track: ${track}`);
}

/**
 * Gets the track assignment for a gap.
 */
export async function getGapTrack(
  base: TrackStore,
  gapId: string
): Promise<{ track: EvolutionTrack; priority: number } | null> {
  const normalizedId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts = :zero',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`,
        ':zero': 0,
      },
    });

    if (items.length === 0) return null;

    return {
      track: items[0].track as EvolutionTrack,
      priority: (items[0].priority as number) ?? 5,
    };
  } catch (error) {
    logger.error(`[GapTrack] Failed to get track for gap ${gapId}:`, error);
    return null;
  }
}

/**
 * Updates gap metadata fields (impact, priority, confidence, etc.).
 */
export async function updateGapMetadata(
  base: BaseMemoryProvider,
  gapId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const normalizedId = gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
  const numericIdMatch = normalizedId.match(/(\d+)$/);
  const numericId = numericIdMatch ? numericIdMatch[1] : normalizedId;
  const parsedNumericId = Number.parseInt(numericId, 10);
  const defaultTimestamp = Number.isNaN(parsedNumericId) ? 0 : parsedNumericId;

  const userId = `GAP#${numericId}`;
  const timestamp = defaultTimestamp;

  const setClauses: string[] = ['updatedAt = :now'];
  const exprValues: Record<string, unknown> = { ':now': Date.now() };

  const metadataFields = [
    'impact',
    'priority',
    'confidence',
    'complexity',
    'risk',
    'urgency',
  ] as const;

  for (const field of metadataFields) {
    if (metadata[field] !== undefined) {
      setClauses.push(`metadata.${field} = :${field}`);
      exprValues[`:${field}`] = metadata[field];
    }
  }

  if (setClauses.length === 1) return;

  try {
    await base.updateItem({
      Key: { userId, timestamp },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: exprValues,
    });
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      logger.warn(
        `[GapMetadata] Primary key lookup failed for gap ${gapId}, searching all statuses...`
      );
      const allStatuses = Object.values(GapStatus);
      for (const s of allStatuses) {
        const gaps = await getAllGaps(base, s);
        const target = gaps.find((g) => {
          const gIdNorm = g.id.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
          const gIdMatch = gIdNorm.match(/(\d+)$/);
          const gIdFinal = gIdMatch ? gIdMatch[1] : gIdNorm;
          return gIdFinal === numericId;
        });
        if (target) {
          try {
            await base.updateItem({
              Key: { userId: target.id, timestamp: target.timestamp },
              UpdateExpression: `SET ${setClauses.join(', ')}`,
              ExpressionAttributeValues: exprValues,
            });
            return;
          } catch (e) {
            logger.error(`[GapMetadata] Fallback update also failed for gap ${gapId}:`, e);
          }
        }
      }
      logger.error(`[GapMetadata] Gap ${gapId} not found in any status`);
    } else {
      logger.error(`[GapMetadata] Error updating gap ${gapId} metadata:`, error);
    }
  }
}

/**
 * Determines the appropriate track for a gap based on its content keywords.
 * Returns the most relevant track by keyword matching.
 */
export function determineTrack(content: string): EvolutionTrack {
  const lower = content.toLowerCase();

  const scores: Record<EvolutionTrack, number> = {
    [EvolutionTrack.SECURITY]: 0,
    [EvolutionTrack.PERFORMANCE]: 0,
    [EvolutionTrack.FEATURE]: 0,
    [EvolutionTrack.INFRASTRUCTURE]: 0,
    [EvolutionTrack.REFACTORING]: 0,
  };

  // Security keywords
  for (const kw of [
    'security',
    'auth',
    'injection',
    'vulnerability',
    'permission',
    'secret',
    'encrypt',
    'xss',
    'csrf',
    'rbac',
  ]) {
    if (lower.includes(kw)) scores[EvolutionTrack.SECURITY] += 2;
  }

  // Performance keywords
  for (const kw of [
    'latency',
    'cache',
    'memory',
    'cpu',
    'optimize',
    'slow',
    'timeout',
    'throughput',
    'bottleneck',
    'performance',
  ]) {
    if (lower.includes(kw)) scores[EvolutionTrack.PERFORMANCE] += 2;
  }

  // Infrastructure keywords
  for (const kw of [
    'deploy',
    'lambda',
    'dynamodb',
    'sst',
    'infra',
    'iam',
    'cloudformation',
    'pipeline',
    'ci/cd',
    'buildspec',
  ]) {
    if (lower.includes(kw)) scores[EvolutionTrack.INFRASTRUCTURE] += 2;
  }

  // Refactoring keywords
  for (const kw of [
    'refactor',
    'cleanup',
    'debt',
    'rename',
    'reorganize',
    'consolidate',
    'simplify',
    'extract',
  ]) {
    if (lower.includes(kw)) scores[EvolutionTrack.REFACTORING] += 2;
  }

  // Feature is the default (doesn't need specific keywords)

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return EvolutionTrack.FEATURE;

  return (
    (Object.entries(scores).find(([, s]) => s === maxScore)?.[0] as EvolutionTrack) ??
    EvolutionTrack.FEATURE
  );
}
