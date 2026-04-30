import { BaseMemoryProvider } from './base';
import { IMemory } from '../types/index';
import { MEMORY_KEYS, RETENTION, TIME } from '../constants';
import { logger } from '../logger';
import { ContextualScope } from '../types/memory';

export interface FailedPlan {
  planId: string;
  agentId: string;
  task: string;
  plan: string;
  failureReason: string;
  timestamp: number;
  traceId?: string;
  expiresAt: number;
}

/**
 * Negative Memory Handler
 * Implements "Negative Memory Tier" to prevent Strategic Planner from repeating failures.
 * (Principle 16: Evolution Analytics)
 */
export class NegativeMemory {
  private base: IMemory;

  constructor(base?: IMemory) {
    this.base = base ?? (new BaseMemoryProvider() as unknown as IMemory);
  }

  /**
   * Records a failed plan to the negative memory tier.
   */
  async recordFailure(
    agentId: string,
    task: string,
    plan: string,
    failureReason: string,
    options?: { traceId?: string; scope?: ContextualScope }
  ): Promise<void> {
    const planId = `fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const expiresAt = Math.floor(now / 1000) + RETENTION.LESSONS_DAYS * TIME.SECONDS_IN_DAY;

    const record: FailedPlan = {
      planId,
      agentId,
      task,
      plan,
      failureReason,
      timestamp: now,
      traceId: options?.traceId,
      expiresAt,
    };

    const pk = `${MEMORY_KEYS.FAILED_PLAN_PREFIX}${agentId}`;
    const scopedPk = this.base.getScopedUserId(pk, options?.scope);

    try {
      await this.base.putItem({
        userId: scopedPk,
        type: 'FAILED_PLAN',
        ...record,
      });
      logger.info(
        `[NEGATIVE_MEMORY] Recorded failed plan for agent ${agentId} (Task: ${task.substring(0, 50)}...)`
      );
    } catch (e) {
      logger.warn('[NEGATIVE_MEMORY] Failed to record failure:', e);
    }
  }

  /**
   * Retrieves recent failed plans for a given agent and task context.
   */
  async getRecentFailures(
    agentId: string,
    limit: number = 5,
    scope?: ContextualScope
  ): Promise<FailedPlan[]> {
    const pk = `${MEMORY_KEYS.FAILED_PLAN_PREFIX}${agentId}`;
    const scopedPk = this.base.getScopedUserId(pk, scope);

    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk',
        ExpressionAttributeValues: { ':pk': scopedPk },
        ScanIndexForward: false,
        Limit: limit,
      });

      return items as unknown as FailedPlan[];
    } catch (e) {
      logger.warn('[NEGATIVE_MEMORY] Failed to query failures:', e);
      return [];
    }
  }

  /**
   * Formats failed plans into a string suitable for inclusion in an agent prompt.
   */
  async getNegativeContext(agentId: string, scope?: ContextualScope): Promise<string> {
    const failures = await this.getRecentFailures(agentId, 3, scope);
    if (failures.length === 0) return '';

    let context = '\n### NEGATIVE CONTEXT (Avoid repeating these failures)\n';
    failures.forEach((f, i) => {
      context += `${i + 1}. **Task**: ${f.task}\n   **Reason**: ${f.failureReason}\n   **Plan Extract**: ${f.plan.substring(0, 200)}...\n\n`;
    });
    return context;
  }
}
