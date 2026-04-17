/**
 * @module BlastRadiusStore
 * @description DynamoDB-backed storage for Class C action blast radius tracking.
 * Provides persistence across Lambda cold starts to enforce 5/hour limit correctly.
 */

import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getConfigTableName } from '../utils/ddb-client';
import { SAFETY_LIMITS } from '../constants/safety';

const BLAST_RADIUS_KEY_PREFIX = 'safety:blast_radius';
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

function makeKey(agentId: string, action: string): string {
  return `${BLAST_RADIUS_KEY_PREFIX}:${agentId}:${action}`;
}

export class BlastRadiusStore {
  private localCache: Map<string, BlastRadiusEntry> = new Map();

  async getBlastRadius(agentId: string, action: string): Promise<BlastRadiusEntry | null> {
    const key = makeKey(agentId, action);
    const now = Date.now();
    const db = getDocClient();

    const cached = this.localCache.get(key);
    if (cached && now - cached.lastAction < WINDOW_MS) {
      return cached;
    }

    const { Item } = await db.send(
      new GetCommand({
        TableName: getConfigTableName(),
        Key: { key },
      })
    );

    if (!Item?.value) return null;

    const entry: BlastRadiusEntry = {
      key,
      count: Item.value.count ?? 0,
      lastAction: Item.value.lastAction ?? 0,
      resourceCount: Item.value.resourceCount ?? 0,
      expiresAt: Item.value.expiresAt,
    };

    // Note: We no longer perform "get-then-delete" here (metabolic waste).
    // Window resets are now handled atomically during increment (Principle 13).
    if (now > (entry.expiresAt ?? 0)) {
      this.localCache.delete(key);
      return null;
    }

    this.localCache.set(key, entry);
    return entry;
  }

  async incrementBlastRadius(
    agentId: string,
    action: string,
    resource?: string,
    retryCount: number = 0
  ): Promise<BlastRadiusEntry> {
    const key = makeKey(agentId, action);
    const now = Date.now();
    const db = getDocClient();

    try {
      // Phase 1: Try atomic increment ONLY if window is still active
      const response = await db.send(
        new UpdateCommand({
          TableName: getConfigTableName(),
          Key: { key },
          UpdateExpression: 'SET #val.#la = :now ADD #val.#cnt :one, #val.#rcnt :resCnt',
          ConditionExpression: 'attribute_exists(#val) AND #val.#exp > :now',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#cnt': 'count',
            '#la': 'lastAction',
            '#exp': 'expiresAt',
            '#rcnt': 'resourceCount',
          },
          ExpressionAttributeValues: { ':one': 1, ':now': now, ':resCnt': resource ? 1 : 0 },
          ReturnValues: 'ALL_NEW',
        })
      );

      const val = response.Attributes?.value;
      const entry = { key, ...val } as BlastRadiusEntry;
      this.localCache.set(key, entry);
      return entry;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // Phase 2: Window expired or record missing - Perform atomic reset
        const expiresAt = now + WINDOW_MS;
        const response = await db
          .send(
            new UpdateCommand({
              TableName: getConfigTableName(),
              Key: { key },
              UpdateExpression: 'SET #val = :newEntry',
              // Condition ensure we don't overwrite if another turn just initialized it
              ConditionExpression: 'attribute_not_exists(#val) OR #val.#exp <= :now',
              ExpressionAttributeNames: { '#val': 'value', '#exp': 'expiresAt' },
              ExpressionAttributeValues: {
                ':newEntry': {
                  count: 1,
                  lastAction: now,
                  resourceCount: resource ? 1 : 0,
                  expiresAt,
                },
                ':now': now,
              },
              ReturnValues: 'ALL_NEW',
            })
          )
          .catch((innerE: unknown) => {
            if (innerE instanceof Error && innerE.name === 'ConditionalCheckFailedException') {
              // Guard against infinite recursion - max 3 retries
              if (retryCount >= MAX_RETRY_COUNT) {
                logger.warn(
                  `[BlastRadiusStore] Max retry count exceeded for ${key}, allowing operation`
                );
                const fallbackEntry: BlastRadiusEntry = {
                  key,
                  count: 1,
                  lastAction: now,
                  resourceCount: resource ? 1 : 0,
                  expiresAt,
                };
                return fallbackEntry;
              }
              return this.incrementBlastRadius(agentId, action, resource, retryCount + 1);
            }
            throw innerE;
          });

        let entry: BlastRadiusEntry;
        if ('Attributes' in response) {
          const val = (response as { Attributes?: { value?: BlastRadiusEntry } }).Attributes?.value;
          entry = val
            ? { ...val, key }
            : { count: 1, lastAction: now, resourceCount: resource ? 1 : 0, expiresAt, key };
        } else {
          entry = { ...(response as BlastRadiusEntry), key };
        }
        this.localCache.set(key, entry);
        return entry;
      }
      throw e;
    }
  }

  /**
   * Check if agent can execute action within blast radius limits.
   * Uses canExecute internally for consistency.
   */
  async checkLimit(agentId: string, action: string): Promise<{ allowed: boolean; count: number }> {
    const result = await this.canExecute(agentId, action);
    const entry = await this.getBlastRadius(agentId, action);
    return { allowed: result.allowed, count: entry?.count ?? 0 };
  }

  /**
   * Check if agent can execute action and return detailed result.
   */
  async canExecute(agentId: string, action: string): Promise<{ allowed: boolean; error?: string }> {
    const entry = await this.getBlastRadius(agentId, action);
    const count = entry?.count ?? 0;

    if (count >= LIMIT_PER_HOUR) {
      const errorMsg = `BLAST_RADIUS_EXCEEDED: Action '${action}' has reached its safety limit (${count}/${LIMIT_PER_HOUR} in 1h). Further execution blocked for safety.`;
      return { allowed: false, error: errorMsg };
    }

    return { allowed: true };
  }

  private async deleteBlastRadius(agentId: string, action: string): Promise<void> {
    const key = makeKey(agentId, action);
    this.localCache.delete(key);

    const db = getDocClient();
    try {
      await db.send(
        new DeleteCommand({
          TableName: getConfigTableName(),
          Key: { key },
        })
      );
    } catch (e) {
      logger.warn(`[BlastRadiusStore] Failed to delete blast radius for ${key}:`, e);
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
