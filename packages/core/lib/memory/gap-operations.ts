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
import { LIMITS, TIME, MEMORY_KEYS, RETENTION } from '../constants';
import type { BaseMemoryProvider } from './base';
import {
  createMetadata,
  queryByTypeAndMap,
  normalizeGapId,
  getGapIdPK,
  getGapTimestamp,
  resolveItemById,
  atomicUpdateMetadata,
  atomicIncrement,
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
 */
export async function getAllGaps(
  base: BaseMemoryProvider,
  status: GapStatus = GapStatus.OPEN,
  scope?: string | import('../types/memory').ContextualScope
): Promise<MemoryInsight[]> {
  return queryByTypeAndMap(
    base,
    'GAP',
    InsightCategory.STRATEGIC_GAP,
    100,
    '#status = :status',
    { ':status': status },
    undefined,
    scope
  );
}

/**
 * Archives stale gaps that have been open for longer than the specified days.
 */
export async function archiveStaleGaps(
  base: BaseMemoryProvider,
  staleDays: number = LIMITS.STALE_GAP_DAYS,
  scope?: string | import('../types/memory').ContextualScope
): Promise<number> {
  const cutoffTime = Date.now() - staleDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

  const gaps = await queryByTypeAndMap(
    base,
    'GAP',
    InsightCategory.STRATEGIC_GAP,
    200,
    '#status IN (:open, :planned)',
    {
      ':open': GapStatus.OPEN,
      ':planned': GapStatus.PLANNED,
    },
    undefined,
    scope
  );

  const staleGaps = gaps.filter((gap) => gap.createdAt && gap.createdAt < cutoffTime);

  let archived = 0;
  for (const gap of staleGaps) {
    try {
      await base.updateItem({
        Key: { userId: gap.id, timestamp: gap.timestamp },
        UpdateExpression: 'SET #status = :archived, updatedAt = :now',
        ConditionExpression: '#status IN (:open, :planned)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':archived': GapStatus.ARCHIVED,
          ':open': GapStatus.OPEN,
          ':planned': GapStatus.PLANNED,
          ':now': Date.now(),
        },
      });
      archived++;
      logger.info(`Archived stale gap: ${gap.id}`);
    } catch (e: unknown) {
      logger.warn(`Failed to archive gap ${gap.id}:`, e);
    }
  }

  return archived;
}

/**
 * Culls resolved gaps that are older than the retention threshold.
 */
export async function cullResolvedGaps(
  base: BaseMemoryProvider,
  thresholdDays: number = RETENTION.GAPS_DAYS,
  scope?: string | import('../types/memory').ContextualScope
): Promise<number> {
  const cutoffTime = Date.now() - thresholdDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

  const gaps = await queryByTypeAndMap(
    base,
    'GAP',
    InsightCategory.STRATEGIC_GAP,
    200,
    '#status IN (:done, :deployed)',
    {
      ':done': GapStatus.DONE,
      ':deployed': GapStatus.DEPLOYED,
    },
    undefined,
    scope
  );

  const staleGaps = gaps.filter((gap) => gap.createdAt && gap.createdAt < cutoffTime);

  let deleted = 0;
  for (const gap of staleGaps) {
    try {
      await base.deleteItem({
        userId: gap.id,
        timestamp: gap.timestamp,
      });
      deleted++;
      logger.info(`Culled resolved gap: ${gap.id}`);
    } catch (e: unknown) {
      logger.warn(`Failed to cull gap ${gap.id}:`, e);
    }
  }

  return deleted;
}

/**
 * Records a new capability gap.
 */
export async function setGap(
  base: BaseMemoryProvider,
  gapId: string,
  details: string,
  metadata?: Partial<InsightMetadata>,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('GAP', '');
  const normalizedGapId = normalizeGapId(gapId);
  const timestamp = getGapTimestamp(normalizedGapId);

  await base.putItem({
    userId: base.getScopedUserId(getGapIdPK(normalizedGapId), scope),
    timestamp: timestamp,
    createdAt: timestamp || Date.now(),
    type,
    expiresAt,
    content: details,
    status: GapStatus.OPEN,
    metadata: createMetadata(metadata ?? { category: InsightCategory.STRATEGIC_GAP }, timestamp),
  });
}

/**
 * Retrieves a specific capability gap by its ID.
 */
export async function getGap(
  base: BaseMemoryProvider,
  gapId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<MemoryInsight | null> {
  return resolveItemById(base, gapId, 'GAP', scope);
}

/**
 * Atomically increments the attempt counter on a capability gap.
 * Prevents "ghost item" creation by verifying the Partition Key exists.
 */
export async function incrementGapAttemptCount(
  base: BaseMemoryProvider,
  gapId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<number> {
  const target = await resolveItemById(base, gapId, 'GAP', scope);
  if (!target) {
    logger.warn(`[incrementGapAttemptCount] Abandoning increment: Gap ${gapId} not found.`);
    return 0;
  }

  return atomicIncrement(base, target.id, target.timestamp, 'retryCount', true);
}

/**
 * Transitions a capability gap to a new status.
 */
export async function updateGapStatus(
  base: BaseMemoryProvider,
  gapId: string,
  status: GapStatus,
  scope?: string | import('../types/memory').ContextualScope,
  metadata?: Record<string, unknown>
): Promise<GapTransitionResult> {
  const target = await resolveItemById(base, gapId, 'GAP', scope);
  if (!target) {
    return { success: false, error: `Gap ${gapId} not found in any status` };
  }

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
  let updateExpr = 'SET #status = :status, updatedAt = :now';
  const exprValues: Record<string, unknown> = {
    ':status': status,
    ':targetId': target.id,
    ':now': Date.now(),
    ...(guard ? { ':expectedStatus': guard.expectedStatus } : {}),
  };
  const exprNames: Record<string, string> = { '#status': 'status' };

  if (metadata) {
    const metaEntries = Object.entries(metadata).map(([key], idx) => {
      return `${key} = :metaVal${idx}`;
    });
    Object.entries(metadata).forEach(([key], idx) => {
      exprValues[`:metaVal${idx}`] = metadata[key];
    });
    updateExpr += ', ' + metaEntries.join(', ');
  }

  const params: Record<string, unknown> = {
    Key: { userId: target.id, timestamp: target.timestamp },
    UpdateExpression: updateExpr,
    ConditionExpression: guard
      ? 'attribute_exists(userId) AND userId = :targetId AND #status = :expectedStatus'
      : 'attribute_exists(userId) AND userId = :targetId',
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  };

  try {
    await base.updateItem(params);
    return { success: true };
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      if (guard) {
        try {
          const { EVOLUTION_METRICS } = await import('../metrics/evolution-metrics');
          const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
          EVOLUTION_METRICS.recordTransitionRejection(
            gapId,
            target.status ?? 'unknown',
            status,
            'guard-mismatch',
            {
              workspaceId,
            }
          );
        } catch {
          /* ignore */
        }
        return {
          success: false,
          error: `Cannot transition gap ${gapId} from ${target.status} to ${status}: expected ${guard.expectedStatus}`,
        };
      }
      return { success: false, error: `Gap ${gapId} status update rejected by guard.` };
    }
    logger.error(`[updateGapStatus] Failed for gap ${gapId}:`, error);
    return { success: false, error: `Update failed: ${String(error)}` };
  }
}

/**
 * Acquires a lock on a gap.
 */
export async function acquireGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  agentId: string,
  ttlMs: number = GAP_LOCK_TTL_MS,
  scope?: string | import('../types/memory').ContextualScope
): Promise<boolean> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(`${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`, scope);
  const now = Date.now();
  const expiresAt = Math.floor((now + ttlMs) / 1000);

  try {
    await base.updateItem({
      Key: { userId: lockKey, timestamp: 0 },
      UpdateExpression:
        'SET #tp = :type, #content = :agentId, #status = :locked, expiresAt = :exp, acquiredAt = :now, lockVersion = :version',
      ConditionExpression: 'attribute_not_exists(userId) OR expiresAt < :nowSec',
      ExpressionAttributeNames: { '#tp': 'type', '#content': 'agentId', '#status': 'status' },
      ExpressionAttributeValues: {
        ':type': 'GAP_LOCK',
        ':agentId': agentId,
        ':locked': 'LOCKED',
        ':exp': expiresAt,
        ':now': now,
        ':nowSec': Math.floor(now / 1000),
        ':version': now,
      },
    });
    return true;
  } catch (error: unknown) {
    if ((error as Error).name === 'ConditionalCheckFailedException') {
      try {
        const { EVOLUTION_METRICS } = await import('../metrics/evolution-metrics');
        const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
        EVOLUTION_METRICS.recordLockContention(normalizedGapId, agentId, { workspaceId });
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}

/**
 * Releases a gap lock.
 */
export async function releaseGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  agentId: string,
  expectedVersion?: number,
  force: boolean = false,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(`${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`, scope);

  const conditionExpr = force
    ? 'attribute_exists(userId)'
    : '#content = :agentId' + (expectedVersion ? ' AND lockVersion = :version' : '');
  const exprValues: Record<string, unknown> = { ':agentId': agentId };
  if (expectedVersion) exprValues[':version'] = expectedVersion;

  try {
    await base.deleteItem({
      userId: lockKey,
      timestamp: 0,
      ConditionExpression: conditionExpr,
      ExpressionAttributeNames: { '#content': 'agentId' },
      ExpressionAttributeValues: exprValues,
    });
  } catch (e) {
    logger.warn(`[releaseGapLock] Failed to release lock for gap ${gapId} by agent ${agentId}:`, e);
  }
}

/**
 * Checks if a gap is locked.
 */
export async function getGapLock(
  base: BaseMemoryProvider,
  gapId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
  const normalizedGapId = normalizeGapId(gapId);
  const lockKey = base.getScopedUserId(`${MEMORY_KEYS.GAP_LOCK_PREFIX}${normalizedGapId}`, scope);
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :lockKey AND #ts = :zero',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':lockKey': lockKey, ':zero': 0 },
    });
    if (items.length === 0) return null;
    const lock = items[0];
    if ((lock.expiresAt as number) < Math.floor(Date.now() / 1000)) return null;
    return {
      agentId: lock.agentId as string,
      expiresAt: lock.expiresAt as number,
      lockVersion: lock.lockVersion as number,
    };
  } catch {
    return { agentId: '__LOCK_CHECK_FAILED__', expiresAt: Infinity };
  }
}

/**
 * Assigns a gap to an evolution track.
 */
export async function assignGapToTrack(
  base: TrackStore,
  gapId: string,
  track: EvolutionTrack,
  priority?: number,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const transitionResult = await updateGapStatus(
    base as unknown as BaseMemoryProvider,
    gapId,
    GapStatus.PLANNED,
    scope
  );
  if (!transitionResult.success) {
    throw new Error(
      `[GapTrack] Failed to transition ${gapId} to PLANNED: ${transitionResult.error}`
    );
  }

  const normalizedId = normalizeGapId(gapId);
  const getScopedUserId = (id: string, s?: string | import('../types/memory').ContextualScope) => {
    const provider = base as unknown as { getScopedUserId?: (id: string, s?: unknown) => string };
    if (typeof provider.getScopedUserId === 'function') {
      return provider.getScopedUserId(id, s);
    }
    const wid = typeof s === 'string' ? s : s?.workspaceId;
    return wid ? `WS#${wid}#${id}` : id;
  };

  await base.putItem({
    userId: getScopedUserId(`${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`, scope),
    timestamp: 0,
    type: 'TRACK_ASSIGNMENT',
    gapId: normalizedId,
    track,
    priority: priority ?? 5,
    assignedAt: Date.now(),
    createdAt: Date.now(),
    expiresAt: Math.floor(Date.now() / 1000) + RETENTION.GAPS_DAYS * 86400,
  });
}

/**
 * Gets the track assignment for a gap.
 */
export async function getGapTrack(
  base: TrackStore,
  gapId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<{ track: EvolutionTrack; priority: number } | null> {
  const normalizedId = normalizeGapId(gapId);
  const getScopedUserId = (id: string, s?: string | import('../types/memory').ContextualScope) => {
    const provider = base as unknown as { getScopedUserId?: (id: string, s?: unknown) => string };
    if (typeof provider.getScopedUserId === 'function') {
      return provider.getScopedUserId(id, s);
    }
    const wid = typeof s === 'string' ? s : s?.workspaceId;
    return wid ? `WS#${wid}#${id}` : id;
  };

  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts = :zero',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': getScopedUserId(`${MEMORY_KEYS.TRACK_PREFIX}${normalizedId}`, scope),
        ':zero': 0,
      },
    });
    if (items.length === 0) return null;
    return { track: items[0].track as EvolutionTrack, priority: items[0].priority as number };
  } catch {
    return null;
  }
}

/**
 * Updates gap metadata.
 */
export async function updateGapMetadata(
  base: BaseMemoryProvider,
  gapId: string,
  metadata: Record<string, unknown>,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const normalizedId = normalizeGapId(gapId);
  const gapTimestamp = getGapTimestamp(normalizedId);
  const scopedUserId = base.getScopedUserId(getGapIdPK(normalizedId), scope);

  // If timestamp is not a real timestamp, resolve first
  if (gapTimestamp < TIME.EPOCH_2020_MS) {
    const target = await resolveItemById(base, gapId, 'GAP', scope);
    if (target) {
      try {
        await atomicUpdateMetadata(base, target.id, target.timestamp, metadata, scope);
        return;
      } catch {
        /* ignore */
      }
    }
    // Leap of faith for numeric IDs even if resolution (mock) fails
    if (gapTimestamp !== 0) {
      try {
        await atomicUpdateMetadata(base, scopedUserId, gapTimestamp, metadata, scope);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  try {
    await atomicUpdateMetadata(base, scopedUserId, gapTimestamp, metadata, scope);
  } catch {
    const target = await resolveItemById(base, gapId, 'GAP', scope);
    if (target) {
      try {
        await atomicUpdateMetadata(base, target.id, target.timestamp, metadata, scope);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Determines the appropriate track for a gap based on its content keywords.
 */
export function determineTrack(content: string): EvolutionTrack {
  const lower = content.toLowerCase();
  if (lower.match(/security|auth|vulnerability|permission|secret|encrypt|xss|csrf|rbac/))
    return EvolutionTrack.SECURITY;
  if (lower.match(/latency|memory|cpu|optimize|slow|timeout|throughput|bottleneck|performance/))
    return EvolutionTrack.PERFORMANCE;
  if (lower.match(/lambda|sst|pipeline|infra|deployment|cloud/))
    return EvolutionTrack.INFRASTRUCTURE;
  if (lower.match(/refactor|duplicate|cleanup|debt|complexity/)) return EvolutionTrack.REFACTORING;
  return EvolutionTrack.FEATURE;
}
