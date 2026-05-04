import { SafetyPolicy, SafetyEvaluationResult } from '../types/agent';
import { logger } from '../logger';
import type { BaseMemoryProvider } from '../memory/base';
import { MEMORY_KEYS } from '../constants';
import { LRUCache } from '../utils/lru';

export interface ToolSafetyOverride {
  toolName: string;
  requireApproval?: boolean;
  maxUsesPerHour?: number;
  maxUsesPerDay?: number;
}

export class SafetyRateLimiter {
  private rateLimitCounters: LRUCache<string, { count: number; resetTime: number }>;
  private evalCount = 0;

  constructor(private base?: BaseMemoryProvider) {
    this.rateLimitCounters = new LRUCache(5000); // LRU bound to 5000 counters
  }

  async checkRateLimits(
    policy: SafetyPolicy,
    action: string,
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): Promise<SafetyEvaluationResult> {
    const now = Date.now();
    const hourKey = `${action}_hour_${Math.floor(now / 3600000)}`;
    const dayKey = `${action}_day_${Math.floor(now / 86400000)}`;

    if (action === 'shell_command' && policy.maxShellCommandsPerHour) {
      if (
        !(await this.checkRateLimitAtomic(hourKey, policy.maxShellCommandsPerHour, 3600000, scope))
      ) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Shell command rate limit exceeded (${policy.maxShellCommandsPerHour}/hour)`,
          appliedPolicy: 'rate_limit_hourly',
        };
      }
    }

    if (action === 'file_operation' && policy.maxFileWritesPerHour) {
      if (
        !(await this.checkRateLimitAtomic(hourKey, policy.maxFileWritesPerHour, 3600000, scope))
      ) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `File write rate limit exceeded (${policy.maxFileWritesPerHour}/hour)`,
          appliedPolicy: 'rate_limit_hourly',
        };
      }
    }

    if (action === 'deployment' && policy.maxDeploymentsPerDay) {
      if (
        !(await this.checkRateLimitAtomic(dayKey, policy.maxDeploymentsPerDay, 86400000, scope))
      ) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Deployment rate limit exceeded (${policy.maxDeploymentsPerDay}/day)`,
          appliedPolicy: 'rate_limit_daily',
        };
      }
    }

    return { allowed: true, requiresApproval: false };
  }

  async checkToolRateLimit(
    override: ToolSafetyOverride | undefined,
    toolName: string,
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): Promise<SafetyEvaluationResult> {
    if (!override) {
      return { allowed: true, requiresApproval: false };
    }

    const now = Date.now();
    const hourKey = `tool_${toolName}_hour_${Math.floor(now / 3600000)}`;
    const dayKey = `tool_${toolName}_day_${Math.floor(now / 86400000)}`;

    if (override.maxUsesPerHour) {
      if (!(await this.checkRateLimitAtomic(hourKey, override.maxUsesPerHour, 3600000, scope))) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Tool '${toolName}' rate limit exceeded (${override.maxUsesPerHour}/hour)`,
          appliedPolicy: 'tool_rate_limit_hourly',
        };
      }
    }

    if (override.maxUsesPerDay) {
      if (!(await this.checkRateLimitAtomic(dayKey, override.maxUsesPerDay, 86400000, scope))) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Tool '${toolName}' rate limit exceeded (${override.maxUsesPerDay}/day)`,
          appliedPolicy: 'tool_rate_limit_daily',
        };
      }
    }

    return { allowed: true, requiresApproval: false };
  }

  private async checkRateLimitAtomic(
    key: string,
    limit: number,
    windowMs: number,
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): Promise<boolean> {
    this.evalCount++;
    if (this.evalCount % 100 === 0) {
      this.pruneStaleCounters();
    }

    if (!this.base) {
      return this.checkRateLimitInMemory(key, limit, windowMs, scope);
    }

    const windowId = Math.floor(Date.now() / windowMs);
    const pk = `${MEMORY_KEYS.HEALTH_PREFIX}RATE#${key}#${windowId}`;
    const scopedUserId = this.base.getScopedUserId(pk, scope);

    try {
      await this.base.updateItem({
        Key: { userId: scopedUserId, timestamp: 0 },
        UpdateExpression: 'SET #c = if_not_exists(#c, :z) + :o, expiresAt = :e',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :lim',
        ExpressionAttributeNames: { '#c': 'count' },
        ExpressionAttributeValues: {
          ':z': 0,
          ':o': 1,
          ':lim': limit,
          ':e': Math.floor((Date.now() + windowMs) / 1000),
        },
        ReturnValues: 'NONE',
      });
      return true;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false;
      }
      // Fail-closed for safety: if DDB fails, reject the request to prevent rate limit bypass
      // Only fall back to in-memory for non-critical operations
      logger.error('Rate limit check failed (fail-closed)', { key, scope, err });
      return false;
    }
  }

  private checkRateLimitInMemory(
    key: string,
    limit: number,
    windowMs: number,
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): boolean {
    let memoryKey = key;
    if (scope) {
      const parts = [];
      if (scope.orgId) parts.push(`ORG:${scope.orgId}`);
      if (scope.teamId) parts.push(`TEAM:${scope.teamId}`);
      if (scope.staffId) parts.push(`STAFF:${scope.staffId}`);
      if (scope.workspaceId) parts.push(`WSID:${scope.workspaceId}`);
      if (parts.length > 0) {
        memoryKey = `WS#${parts.join('#')}#${key}`;
      }
    }

    const counter = this.rateLimitCounters.get(memoryKey);
    if (!counter || Date.now() > counter.resetTime) {
      this.rateLimitCounters.set(memoryKey, { count: 1, resetTime: Date.now() + windowMs });
      return true;
    }
    if (counter.count >= limit) return false;
    counter.count++;
    return true;
  }

  private pruneStaleCounters(): void {
    const now = Date.now();
    for (const [key, counter] of this.rateLimitCounters) {
      if (now > counter.resetTime) {
        this.rateLimitCounters.delete(key);
      }
    }
  }
}
