/**
 * Gap Operations Module
 *
 * Contains gap management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, GapStatus, InsightCategory } from '../types/index';
import { logger } from '../logger';
import { RetentionManager } from './tiering';
import { LIMITS, TIME } from '../constants';
import type { BaseMemoryProvider } from './base';
import { createMetadata } from './utils';

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
    id: item.userId,
    content: item.content,
    timestamp: item.timestamp,
    metadata: createMetadata(
      item.metadata ?? { category: InsightCategory.STRATEGIC_GAP },
      item.timestamp
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

  const staleGaps = items.filter((item) => item.timestamp && item.timestamp < cutoffTime);

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
  const parsedGapId = Number.parseInt(gapId, 10);
  const gapTimestamp = Number.isNaN(parsedGapId) ? Date.now() : parsedGapId;
  await base.putItem({
    userId: `GAP#${gapId}`,
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
    const result = await base.updateItem({
      Key: {
        userId: `GAP#${numericId}`,
        timestamp: gapTimestamp,
      },
      UpdateExpression:
        'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': Date.now(),
      },
      ReturnValues: 'ALL_NEW',
    });
    return (result.Attributes?.attemptCount as number) ?? 1;
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
  const numericId = gapId.replace('GAP#', '');
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
      const target = gaps.find((g) => g.id === `GAP#${numericId}`);
      if (target) {
        params.Key = { userId: `GAP#${numericId}`, timestamp: target.timestamp };

        found = true;
        break;
      }
    }
    if (!found) {
      logger.error(`Gap update aborted: ID ${gapId} not found in any status.`);
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
