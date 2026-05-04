/**
 * @module BlastRadiusStore
 * @description DynamoDB-backed storage for Class C action blast radius tracking.
 * Provides persistence across Lambda cold starts to enforce 5/hour limit correctly.
 */

import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getMemoryTableName } from '../utils/ddb-client';
import { SAFETY_LIMITS } from '../constants/safety';
import { MEMORY_KEYS } from '../constants';

const WINDOW_MS = 3600000; // 1 hour
const LIMIT_PER_HOUR = SAFETY_LIMITS.CLASS_C_MAX_PER_HOUR;
const MAX_RETRY_COUNT = 3;

interface BlastRadiusEntry {
  key: string;
  count: number;
  lastAction: number;
  resourceCount: number;
  expiresAt?: number;
}

function makePk(agentId: string, action: string, workspaceId?: string): string {
  const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';
  return `${scopePrefix}${MEMORY_KEYS.SAFETY_BLAST_RADIUS_PREFIX}${agentId}:${action}`;
}

export class BlastRadiusStore {
  private localCache: Map<string, BlastRadiusEntry> = new Map();

  async getBlastRadius(
    agentId: string,
    action: string,
    workspaceId?: string
  ): Promise<BlastRadiusEntry | null> {
    const pk = makePk(agentId, action, workspaceId);
    const now = Date.now();
    const db = getDocClient();

    const cached = this.localCache.get(pk);
    if (cached && now - cached.lastAction < WINDOW_MS) {
      return cached;
    }

    const { Item } = await db.send(
      new GetCommand({
        TableName: getMemoryTableName(),
        Key: { userId: pk, timestamp: 0 },
      })
    );

    if (!Item) return null;

    const entry: BlastRadiusEntry = {
      key: pk,
      count: Item.count ?? 0,
      lastAction: Item.lastAction ?? 0,
      resourceCount: Item.resourceCount ?? 0,
      expiresAt: Item.expiresAt,
    };

    if (now > (entry.expiresAt ?? 0) * 1000) {
      this.localCache.delete(pk);
      return null;
    }

    this.localCache.set(pk, entry);
    return entry;
  }

  async incrementBlastRadius(
    agentId: string,
    action: string,
    workspaceId?: string,
    resource?: string,
    retryCount: number = 0
  ): Promise<BlastRadiusEntry> {
    const pk = makePk(agentId, action, workspaceId);
    const now = Date.now();
    const db = getDocClient();

    try {
      // Phase 1: Try atomic increment ONLY if window is still active
      const response = await db.send(
        new UpdateCommand({
          TableName: getMemoryTableName(),
          Key: { userId: pk, timestamp: 0 },
          UpdateExpression:
            'SET lastAction = :now, expiresAt = :exp ADD #cnt :one, resourceCount :resCnt',
          ConditionExpression: 'attribute_exists(userId) AND expiresAt > :nowSec',
          ExpressionAttributeNames: {
            '#cnt': 'count',
          },
          ExpressionAttributeValues: {
            ':one': 1,
            ':now': now,
            ':resCnt': resource ? 1 : 0,
            ':nowSec': Math.floor(now / 1000),
            ':exp': Math.floor((now + WINDOW_MS) / 1000), // Keep window alive
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const val = response.Attributes;
      const entry = { key: pk, ...val } as unknown as BlastRadiusEntry;
      this.localCache.set(pk, entry);
      return entry;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // Phase 2: Window expired or record missing - Perform atomic reset
        const expiresAt = Math.floor((now + WINDOW_MS) / 1000);
        const response = await db
          .send(
            new UpdateCommand({
              TableName: getMemoryTableName(),
              Key: { userId: pk, timestamp: 0 },
              UpdateExpression:
                'SET #cnt = :one, lastAction = :now, resourceCount = :resCnt, expiresAt = :exp, #type = :type',
              // Condition ensure we don't overwrite if another turn just initialized it
              ConditionExpression: 'attribute_not_exists(userId) OR expiresAt <= :nowSec',
              ExpressionAttributeNames: { '#cnt': 'count', '#type': 'type' },
              ExpressionAttributeValues: {
                ':one': 1,
                ':now': now,
                ':resCnt': resource ? 1 : 0,
                ':exp': expiresAt,
                ':nowSec': Math.floor(now / 1000),
                ':type': 'SAFETY_BLAST_RADIUS',
              },
              ReturnValues: 'ALL_NEW',
            })
          )
          .catch((innerE: unknown) => {
            if (innerE instanceof Error && innerE.name === 'ConditionalCheckFailedException') {
              // Guard against infinite recursion - max 3 retries
              if (retryCount >= MAX_RETRY_COUNT) {
                logger.error(
                  `[BlastRadiusStore] Max retry count exceeded for ${pk}, failing closed`
                );
                throw new Error(
                  `BLAST_RADIUS_STORE_ERROR: Max retry count exceeded for concurrent writes on ${pk}.`
                );
              }
              return this.incrementBlastRadius(
                agentId,
                action,
                workspaceId,
                resource,
                retryCount + 1
              );
            }
            throw innerE;
          });

        let entry: BlastRadiusEntry;
        if ('Attributes' in response) {
          const val = response.Attributes;
          entry = val
            ? ({ ...val, key: pk } as unknown as BlastRadiusEntry)
            : { count: 1, lastAction: now, resourceCount: resource ? 1 : 0, expiresAt, key: pk };
        } else {
          entry = { ...(response as unknown as BlastRadiusEntry), key: pk };
        }
        this.localCache.set(pk, entry);
        return entry;
      }
      throw e;
    }
  }

  /**
   * Check if agent can execute action within blast radius limits.
   * Uses canExecute internally for consistency.
   */
  async checkLimit(
    agentId: string,
    action: string,
    workspaceId?: string
  ): Promise<{ allowed: boolean; count: number }> {
    const result = await this.canExecute(agentId, action, workspaceId);
    const entry = await this.getBlastRadius(agentId, action, workspaceId);
    return { allowed: result.allowed, count: entry?.count ?? 0 };
  }

  /**
   * Check if agent can execute action and return detailed result.
   */
  async canExecute(
    agentId: string,
    action: string,
    workspaceId?: string
  ): Promise<{ allowed: boolean; error?: string }> {
    const entry = await this.getBlastRadius(agentId, action, workspaceId);
    const count = entry?.count ?? 0;

    if (count >= LIMIT_PER_HOUR) {
      const errorMsg = `BLAST_RADIUS_EXCEEDED: Action '${action}' has reached its safety limit (${count}/${LIMIT_PER_HOUR} in 1h). Further execution blocked for safety.`;
      return { allowed: false, error: errorMsg };
    }

    return { allowed: true };
  }

  private async deleteBlastRadius(
    agentId: string,
    action: string,
    workspaceId?: string
  ): Promise<void> {
    const pk = makePk(agentId, action, workspaceId);
    this.localCache.delete(pk);

    const db = getDocClient();
    try {
      await db.send(
        new DeleteCommand({
          TableName: getMemoryTableName(),
          Key: { userId: pk, timestamp: 0 },
        })
      );
    } catch (e) {
      logger.warn(`[BlastRadiusStore] Failed to delete blast radius for ${pk}:`, e);
    }
  }

  clearLocalCache(): void {
    this.localCache.clear();
  }

  getLocalStats(): Record<string, BlastRadiusEntry> {
    return Object.fromEntries(this.localCache);
  }
}

let _instance: BlastRadiusStore | null = null;

export function getBlastRadiusStore(): BlastRadiusStore {
  if (!_instance) {
    _instance = new BlastRadiusStore();
  }
  return _instance;
}

export function resetBlastRadiusStore(): void {
  _instance = null;
}
