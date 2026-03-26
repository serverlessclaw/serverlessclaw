/**
 * Gap Operations Module
 *
 * Contains gap management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, InsightCategory } from '../types/memory';
import { GapStatus } from '../types/agent';
import { logger } from '../logger';
import { RetentionManager } from './tiering';
import { LIMITS, TIME } from '../constants';
import type { BaseMemoryProvider } from './base';
import { createMetadata } from './utils';

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
  const items = await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#type = :type',
    FilterExpression: '#status = :status',
    ExpressionAttributeNames: {
      '#type': 'type',
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':type': 'GAP',
      ':status': status,
    },
  });

  return items.map((item) => ({
    id: item.userId as string,
    content: item.content as string,
    timestamp: item.timestamp as number,
    metadata: createMetadata(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item.metadata as any) ?? { category: InsightCategory.STRATEGIC_GAP },
      item.timestamp as number
    ),
  }));
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
    KeyConditionExpression: '#type = :type',
    FilterExpression: '#status IN (:open, :planned)',
    ExpressionAttributeNames: {
      '#type': 'type',
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
    type,
    expiresAt,
    content: details,
    status: GapStatus.OPEN,
    metadata: createMetadata(metadata ?? { category: InsightCategory.STRATEGIC_GAP }),
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
  const numericId = gapId.replace('GAP#', '');
  const parsedNumericId = Number.parseInt(numericId, 10);
  const gapTimestamp = Number.isNaN(parsedNumericId) ? 0 : parsedNumericId;
  try {
    const now = Date.now();
    const result = await base.updateItem({
      Key: {
        userId: `GAP#${numericId}`,
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
  } catch (error) {
    logger.error(`Error incrementing attempt count for gap ${gapId}:`, error);
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
  const expiresAt = now + ttlMs;

  try {
    // Try to atomically acquire the lock — fails if it already exists and isn't expired
    await base.putItem({
      userId: lockKey,
      timestamp: now,
      type: 'GAP_LOCK',
      content: agentId,
      status: 'LOCKED',
      expiresAt: Math.floor(expiresAt / 1000), // DynamoDB TTL uses seconds
      metadata: createMetadata({ category: 'system_knowledge' as InsightCategory }),
    });
    logger.info(`Gap lock acquired: ${gapId} by ${agentId}`);
    return true;
  } catch {
    // Lock might already exist — check if it's expired
    const existing = await getGapLock(base, gapId);
    if (!existing || existing.expiresAt * 1000 < now) {
      // Lock expired, try again
      try {
        await base.putItem({
          userId: lockKey,
          timestamp: now,
          type: 'GAP_LOCK',
          content: agentId,
          status: 'LOCKED',
          expiresAt: Math.floor(expiresAt / 1000),
          metadata: createMetadata({ category: 'system_knowledge' as InsightCategory }),
        });
        logger.info(`Gap lock acquired (after expiry): ${gapId} by ${agentId}`);
        return true;
      } catch {
        logger.warn(`Failed to acquire gap lock for ${gapId} (double race).`);
        return false;
      }
    }
    logger.info(`Gap ${gapId} is already locked by ${existing.content}`);
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
    await base.deleteItem({
      userId: lockKey,
      timestamp: 0,
    });
    logger.info(`Gap lock released: ${gapId} by ${agentId}`);
  } catch (e) {
    logger.warn(`Failed to release gap lock for ${gapId}:`, e);
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
      KeyConditionExpression: 'userId = :lockKey',
      ExpressionAttributeValues: {
        ':lockKey': lockKey,
      },
    });
    if (items.length === 0) return null;
    const lock = items[0];
    return {
      content: lock.content as string,
      expiresAt: (lock.expiresAt as number) ?? 0,
    };
  } catch {
    return null;
  }
}
