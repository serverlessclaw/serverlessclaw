/**
 * Gap Operations Module
 *
 * Contains gap management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, InsightCategory } from '../types/memory';
import { GapStatus, EvolutionTrack, GapTransitionResult } from '../types/agent';
import { logger } from '../logger';
import { RetentionManager } from './tiering';
import { LIMITS, TIME, MEMORY_KEYS } from '../constants';
import type { BaseMemoryProvider } from './base';
import {
  createMetadata,
  queryByTypeAndMap,
  normalizeGapId,
  getGapIdPK,
  getGapTimestamp,
} from './utils';

/** Minimal interface for track operations — satisfied by BaseMemoryProvider and DynamoMemory. */
export interface TrackStore {
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
  status: GapStatus = GapStatus.OPEN,
  workspaceId?: string
): Promise<MemoryInsight[]> {
  return queryByTypeAndMap(
    base,
    'GAP',
    InsightCategory.STRATEGIC_GAP,
    100,
    '#status = :status',
    { ':status': status },
    undefined,
    workspaceId
  );
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
  staleDays: number = LIMITS.STALE_GAP_DAYS,
  workspaceId?: string
): Promise<number> {
  const cutoffTime = Date.now() - staleDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

  const items = await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#tp = :type',
    FilterExpression: workspaceId
      ? '#status IN (:open, :planned) AND workspaceId = :wid'
      : '#status IN (:open, :planned)',
    ExpressionAttributeNames: {
      '#tp': 'type',
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':type': 'GAP',
      ':open': GapStatus.OPEN,
      ':planned': GapStatus.PLANNED,
      ...(workspaceId ? { ':wid': workspaceId } : {}),
    },
  });

  const staleGaps = items.filter((item) => {
    const ts =
      (typeof item.timestamp === 'string'
        ? parseInt(item.timestamp, 10)
        : (item.timestamp as number)) || (item.createdAt as number);
    return ts < cutoffTime;
  });

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

export async function cullResolvedGaps(
  base: BaseMemoryProvider,
  thresholdDays: number = 90,
  workspaceId?: string
): Promise<number> {
  const cutoffTime = Date.now() - thresholdDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

  // Get all DONE and DEPLOYED gaps
  const items = await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#tp = :type',
    FilterExpression: '#status IN (:done, :deployed)',
    ExpressionAttributeNames: {
      '#tp': 'type',
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':type': 'GAP',
      ':done': GapStatus.DONE,
      ':deployed': GapStatus.DEPLOYED,
    },
  });

  const staleGaps = items.filter((item) => {
    const ts = ((item.updatedAt as number) ||
      (typeof item.timestamp === 'string'
        ? parseInt(item.timestamp, 10)
        : (item.timestamp as number))) as number;
    return ts < cutoffTime;
  });

  let deleted = 0;
  for (const gap of staleGaps) {
    try {
      if (workspaceId && !(gap.userId as string).startsWith(`WS#${workspaceId}#`)) continue;

      await base.deleteItem({
        userId: gap.userId as string,
        timestamp: gap.timestamp as number | string,
      });
      deleted++;
      logger.info(`Culled resolved gap: ${gap.userId}`);
    } catch (e: unknown) {
      logger.warn(`Failed to cull gap ${gap.userId}:`, e);
    }
  }

  return deleted;
}

/**
 * Records a new capability gap.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The unique identifier for the gap (usually a timestamp).
 * @param details - The textual description of the gap.
 * @param metadata - Optional insight metadata.
 * @param workspaceId - Optional workspace identifier.
 * @returns A promise resolving when the gap is recorded.
 * @since 2026-03-19
 */
export async function setGap(
  base: BaseMemoryProvider,
  gapId: string,
  details: string,
  metadata?: Partial<InsightMetadata>,
  workspaceId?: string
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('GAP', '');
  const normalizedGapId = normalizeGapId(gapId);
  const gapTimestamp = getGapTimestamp(normalizedGapId) || Date.now();
  await base.putItem({
    userId: base.getScopedUserId(getGapIdPK(normalizedGapId), workspaceId),
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
 * Retrieves a specific capability gap by its ID.
 *
 * @param base - The base memory provider instance.
 * @param gapId - The unique identifier for the gap.
 * @returns A promise resolving to the MemoryInsight representing the gap, or null if not found.
 */
export async function getGap(
  base: BaseMemoryProvider,
  gapId: string,
  workspaceId?: string
): Promise<MemoryInsight | null> {
  const normalizedId = normalizeGapId(gapId);
  const pk = base.getScopedUserId(getGapIdPK(normalizedId), workspaceId);
  const sk = getGapTimestamp(normalizedId);

  // 1. Try targeted lookup if we have a valid timestamp
  if (sk !== '0') {
    try {
      const items = await base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :ts',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':pk': pk, ':ts': sk },
      });
      if (items.length > 0) {
        return {
          id: items[0].userId as string,
          timestamp: items[0].timestamp as number | string,
          content: items[0].content as string,
          metadata: (items[0].metadata as InsightMetadata) || {},
        };
      }
    } catch (e) {
      logger.warn(`Direct gap lookup failed for ${normalizedId}, falling back to search:`, e);
    }
  }

  // 2. Fallback: Search across all active gap statuses
  const allStatuses = [GapStatus.OPEN, GapStatus.PLANNED, GapStatus.PROGRESS, GapStatus.DEPLOYED];
  for (const s of allStatuses) {
    const gaps = await getAllGaps(base, s);
    const target = gaps.find((g) => normalizeGapId(g.id) === normalizedId);
    if (target) return target;
  }

  return null;
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
  gapId: string,
  workspaceId?: string
): Promise<number> {
  const normalizedId = normalizeGapId(gapId);
  const gapTimestamp = getGapTimestamp(normalizedId);

  try {
    const now = Date.now();
    const result = await base.updateItem({
      Key: {
        userId: base.getScopedUserId(getGapIdPK(normalizedId), workspaceId),
        timestamp: gapTimestamp,
      },
      UpdateExpression:
        'SET metadata.retryCount = if_not_exists(metadata.retryCount, :zero) + :one, updatedAt = :now, metadata.lastAttemptTime = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    });
    return (result.Attributes?.metadata?.retryCount as number) ?? 1;
  } catch {
    // Fallback: search across all gap statuses to find the item (same as updateGapStatus)
    logger.warn(`Primary key lookup failed for gap ${gapId}, searching all statuses...`);
    const allStatuses = Object.values(GapStatus);
    for (const s of allStatuses) {
      const gaps = await getAllGaps(base, s);
      const target = gaps.find((g) => {
        const gIdNorm = normalizeGapId(g.id);
        const gIdFinal = gIdNorm.match(/(\d+)$/)?.[1] ?? gIdNorm;
        const targetIdFinal = normalizedId.match(/(\d+)$/)?.[1] ?? normalizedId;
        return gIdFinal === targetIdFinal;
      });
      if (target) {
        try {
          const now = Date.now();
          const result = await base.updateItem({
            Key: { userId: target.id, timestamp: target.timestamp },
            UpdateExpression:
              'SET metadata.retryCount = if_not_exists(metadata.retryCount, :zero) + :one, updatedAt = :now, metadata.lastAttemptTime = :now',
            ExpressionAttributeValues: {
              ':zero': 0,
              ':one': 1,
              ':now': now,
            },
            ReturnValues: 'ALL_NEW',
          });
          return (result.Attributes?.metadata?.retryCount as number) ?? 1;
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
 * @returns A promise resolving to a GapTransitionResult indicating success or failure.
 * @since 2026-03-19
 */
export async function updateGapStatus(
  base: BaseMemoryProvider,
  gapId: string,
  status: GapStatus,
  workspaceId?: string
): Promise<GapTransitionResult> {
  const normalizedId = normalizeGapId(gapId);
  const gapTimestamp = getGapTimestamp(normalizedId);

  const params: Record<string, unknown> = {
    Key: {
      userId: base.getScopedUserId(getGapIdPK(normalizedId), workspaceId),
      timestamp: gapTimestamp,
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

  // A4: Atomic status transitions — require current status to match expected predecessor
  const TRANSITION_GUARDS: Partial<
    Record<GapStatus, { expectedStatus: GapStatus; valueKey: string }>
  > = {
    [GapStatus.PLANNED]: { expectedStatus: GapStatus.OPEN, valueKey: ':expectedStatus' },
    [GapStatus.PROGRESS]: { expectedStatus: GapStatus.PLANNED, valueKey: ':expectedStatus' },
    [GapStatus.DEPLOYED]: { expectedStatus: GapStatus.PROGRESS, valueKey: ':expectedStatus' },
    [GapStatus.PENDING_APPROVAL]: {
      expectedStatus: GapStatus.DEPLOYED,
      valueKey: ':expectedStatus',
    },
    [GapStatus.DONE]: { expectedStatus: GapStatus.DEPLOYED, valueKey: ':expectedStatus' },
  };

  const guard = TRANSITION_GUARDS[status];
  if (guard) {
    params.ConditionExpression = 'attribute_exists(userId) AND #status = :expectedStatus';
    (params.ExpressionAttributeValues as Record<string, unknown>)[guard.valueKey] =
      guard.expectedStatus;
  }

  // Strategy 2: If primary key fails, search and retry exactly ONCE with specific timestamp
  if (gapTimestamp === '0') {
    const allStatuses = Object.values(GapStatus);
    let found = false;
    for (const s of allStatuses) {
      const gaps = await getAllGaps(base, s);
      const target = gaps.find((g) => {
        const gIdNorm = normalizeGapId(g.id);
        return gIdNorm === normalizedId;
      });
      if (target) {
        params.Key = { userId: target.id, timestamp: target.timestamp };

        found = true;
        break;
      }
    }
    if (!found) {
      logger.error(`Gap update aborted: ID ${gapId} not found in any status.`);
      return { success: false, error: `Gap ${gapId} not found in any status` };
    }
  }

  try {
    await base.updateItem(params);
    return { success: true };
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      // A4: Handle all guarded transitions, not just DONE
      if (guard) {
        const errorMsg = `Cannot transition gap ${gapId} to ${status}: expected ${guard.expectedStatus} state`;
        logger.warn(`Gap transition failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
      logger.warn(
        `Gap update race condition or missing item: ${gapId}. Retrying with fresh lookup.`
      );
      // Final desperate attempted lookup to see if timestamp shifted
      const all = await getAllGaps(base);
      const retryTarget = all.find((g) => normalizeGapId(g.id) === normalizedId);
      if (retryTarget) {
        params.Key = { userId: getGapIdPK(normalizedId), timestamp: retryTarget.timestamp };
        try {
          await base.updateItem(params);
          return { success: true };
        } catch (e) {
          logger.error(`Failed retry update gap ${gapId} status:`, e);
          return {
            success: false,
            error: `Retry failed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }
      return { success: false, error: `Gap ${gapId} not found after retry lookup` };
    } else {
      logger.error(`Error updating gap ${gapId} status:`, error);
      return {
        success: false,
        error: `Update failed: ${error instanceof Error ? error.message : String(error)}`,
      };
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
  ttlMs: number = GAP_LOCK_TTL_MS,
  workspaceId?: string
): Promise<boolean> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(
    `${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`,
    workspaceId
  );
  const now = Date.now();
  const expiresAt = Math.floor((now + ttlMs) / 1000); // DynamoDB TTL uses seconds

  try {
    // Atomic update to acquire lock if not exists or expired
    // We use timestamp: 0 for all locks to make deletion reliable
    // Use lockVersion for atomic release verification
    const lockVersion = Date.now();
    await base.updateItem({
      Key: {
        userId: lockKey,
        timestamp: '0',
      },
      UpdateExpression:
        'SET #tp = :type, #content = :agentId, #status = :locked, expiresAt = :exp, acquiredAt = :now, lockVersion = :version',
      ConditionExpression: 'attribute_not_exists(userId) OR expiresAt < :nowSec',
      ExpressionAttributeNames: {
        '#tp': 'type',
        '#content': 'agentId',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'GAP_LOCK',
        ':agentId': agentId,
        ':locked': 'LOCKED',
        ':exp': expiresAt,
        ':now': now,
        ':nowSec': Math.floor(now / 1000),
        ':version': lockVersion,
      },
    });
    logger.info(`Gap lock acquired: ${gapId} by ${agentId} (version: ${lockVersion})`);
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
 * @param expectedVersion - Optional version for atomic release verification (from acquireGapLock return).
 * @param force - If true, bypasses ownership check (for admin override).
 */
export async function releaseGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  agentId: string,
  expectedVersion?: number,
  force: boolean = false,
  workspaceId?: string
): Promise<void> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(
    `${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`,
    workspaceId
  );

  // Build condition: must own the lock (and version match if provided)
  let conditionExpr = force ? 'attribute_exists(userId)' : '#content = :agentId';
  const exprNames: Record<string, string> = {
    '#content': 'agentId',
  };
  const exprValues: Record<string, unknown> = {
    ':agentId': agentId,
  };

  if (expectedVersion !== undefined && !force) {
    conditionExpr += ' AND lockVersion = :version';
    exprValues[':version'] = expectedVersion;
  }

  try {
    // Only delete if we are the owner (and version matches if specified)
    await base.deleteItem({
      userId: lockKey,
      timestamp: '0',
      ConditionExpression: conditionExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    });
    logger.info(
      `Gap lock released: ${gapId} by ${agentId}${expectedVersion ? ` (version: ${expectedVersion})` : ''}`
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
      logger.warn(
        `Failed to release gap lock for ${gapId}: not owned by ${agentId}${expectedVersion ? ` (version mismatch: ${expectedVersion})` : ''}`
      );
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
  gapId: string,
  workspaceId?: string
): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(
    `${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`,
    workspaceId
  );
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :lockKey AND #ts = :zero',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':lockKey': lockKey,
        ':zero': '0',
      },
    });
    if (items.length === 0) return null;
    const lock = items[0];
    const nowSec = Math.floor(Date.now() / 1000);
    if ((lock.expiresAt as number) < nowSec) return null;

    return {
      agentId: lock.agentId as string,
      expiresAt: (lock.expiresAt as number) ?? 0,
      lockVersion: lock.lockVersion as number | undefined,
    };
  } catch (error) {
    logger.error('Failed to check gap lock (fail-closed):', error);
    // Fail-closed: return a sentinel indicating we could not verify the lock state.
    // Callers should treat this as "possibly locked" to prevent race conditions.
    return { agentId: '__LOCK_CHECK_FAILED__', expiresAt: Infinity };
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
  const normalizedId = normalizeGapId(gapId);

  const transitionResult = await updateGapStatus(base as never, gapId, GapStatus.PLANNED);
  if (!transitionResult.success) {
    throw new Error(
      `[GapTrack] Failed to transition ${normalizedId} to PLANNED before track assignment: ${transitionResult.error ?? 'unknown error'}`
    );
  }

  await base.putItem({
    userId: `${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`,
    timestamp: '0',
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
  const normalizedId = normalizeGapId(gapId);
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts = :zero',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`,
        ':zero': '0',
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
  metadata: Record<string, unknown>,
  workspaceId?: string
): Promise<void> {
  const normalizedId = normalizeGapId(gapId);
  const gapTimestamp = getGapTimestamp(normalizedId);

  const userId = base.getScopedUserId(getGapIdPK(normalizedId), workspaceId);
  const timestamp = gapTimestamp;

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
      const numericId = normalizedId.match(/(\d+)$/)?.[1] ?? normalizedId;
      const allStatuses = Object.values(GapStatus);
      for (const s of allStatuses) {
        const gaps = await getAllGaps(base, s);
        const target = gaps.find((g) => {
          const gIdNorm = normalizeGapId(g.id);
          const gIdFinal = gIdNorm.match(/(\d+)$/)?.[1] ?? gIdNorm;
          return gIdFinal === numericId;
        });
        if (target) {
          try {
            await base.updateItem({
              Key: { userId: target.id, timestamp: target.timestamp },
              UpdateExpression: `SET ${setClauses.join(', ')}`,
              ExpressionAttributeValues: exprValues,
              ConditionExpression: 'attribute_exists(userId)',
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
