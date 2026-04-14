/**
 * @module BlastRadiusStore
 * @description DynamoDB-backed storage for Class C action blast radius tracking.
 * Provides persistence across Lambda cold starts to enforce 5/hour limit correctly.
 */

import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getConfigTableName } from '../utils/ddb-client';

const BLAST_RADIUS_KEY_PREFIX = 'safety:blast_radius';
const WINDOW_MS = 3600000; // 1 hour
const LIMIT_PER_HOUR = 5;

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

    const cached = this.localCache.get(key);
    if (cached && now - cached.lastAction < WINDOW_MS) {
      return cached;
    }

    const db = getDocClient();
    try {
      const { Item } = await db.send(
        new GetCommand({
          TableName: getConfigTableName(),
          Key: { key },
        })
      );

      if (!Item?.value) {
        return null;
      }

      const entry: BlastRadiusEntry = {
        key,
        count: Item.value.count ?? 0,
        lastAction: Item.value.lastAction ?? 0,
        resourceCount: Item.value.resourceCount ?? 0,
        expiresAt: Item.value.expiresAt,
      };

      if (now - entry.lastAction > WINDOW_MS) {
        await this.deleteBlastRadius(agentId, action);
        return null;
      }

      this.localCache.set(key, entry);
      return entry;
    } catch (e) {
      logger.warn(`[BlastRadiusStore] Failed to get blast radius for ${key}:`, e);
      return cached ?? null;
    }
  }

  async incrementBlastRadius(
    agentId: string,
    action: string,
    resource?: string
  ): Promise<BlastRadiusEntry> {
    const key = makeKey(agentId, action);
    const now = Date.now();
    const expiresAt = now + WINDOW_MS;

    const db = getDocClient();
    try {
      // Use atomic UpdateCommand to increment counts safely
      const response = await db.send(
        new UpdateCommand({
          TableName: getConfigTableName(),
          Key: { key },
          UpdateExpression: 'ADD #cnt :one, #rcnt :resCnt SET #la = :now, #exp = :expires',
          ExpressionAttributeNames: {
            '#cnt': 'count',
            '#rcnt': 'resourceCount',
            '#la': 'lastAction',
            '#exp': 'expiresAt',
          },
          ExpressionAttributeValues: {
            ':one': 1,
            ':resCnt': resource ? 1 : 0,
            ':now': now,
            ':expires': expiresAt,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const val = response.Attributes?.value || response.Attributes;
      const entry: BlastRadiusEntry = {
        key,
        count: val.count ?? 1,
        lastAction: val.lastAction ?? now,
        resourceCount: val.resourceCount ?? (resource ? 1 : 0),
        expiresAt: val.expiresAt ?? expiresAt,
      };

      this.localCache.set(key, entry);
      return entry;
    } catch (e) {
      logger.warn(`[BlastRadiusStore] Failed to atomically increment blast radius for ${key}:`, e);
      // Fallback to local cache if DB fails
      const existing = this.localCache.get(key);
      const entry: BlastRadiusEntry = {
        key,
        count: (existing?.count ?? 0) + 1,
        lastAction: now,
        resourceCount: (existing?.resourceCount ?? 0) + (resource ? 1 : 0),
        expiresAt,
      };
      this.localCache.set(key, entry);
      return entry;
    }
  }

  async checkLimit(agentId: string, action: string): Promise<{ allowed: boolean; count: number }> {
    const entry = await this.getBlastRadius(agentId, action);
    const count = entry?.count ?? 0;

    if (count >= LIMIT_PER_HOUR) {
      return { allowed: false, count };
    }

    return { allowed: true, count };
  }

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
