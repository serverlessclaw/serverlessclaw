/**
 * Evolution Scheduler for Class C pending actions.
 * Tracks actions that require human approval and triggers proactive evolution after a timeout.
 */
import { logger } from '../logger';
import { BaseMemoryProvider } from '../memory/base';
import { EventType } from '../types/agent';
import { emitTypedEvent } from '../utils/typed-emit';

const EVOLUTION_PREFIX = 'EVOLUTION#PENDING#';

export interface PendingEvolution {
  actionId: string;
  agentId: string;
  action: string;
  reason: string;
  toolName?: string;
  args?: Record<string, unknown>;
  resource?: string;
  traceId?: string;
  userId?: string;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
  createdAt: number;
  expiresAt: number; // The "Evolutionary Timeout" timestamp
  status: 'pending' | 'triggered' | 'approved' | 'rejected';
}

export class EvolutionScheduler {
  private base?: BaseMemoryProvider;

  constructor(base?: BaseMemoryProvider) {
    this.base = base;
  }

  /**
   * Schedule a Class C action for proactive evolution.
   */
  async scheduleAction(params: {
    agentId: string;
    action: string;
    reason: string;
    timeoutMs: number;
    toolName?: string;
    args?: Record<string, unknown>;
    resource?: string;
    traceId?: string;
    userId?: string;
    workspaceId?: string;
    orgId?: string;
    teamId?: string;
    staffId?: string;
  }): Promise<string | undefined> {
    if (!this.base) {
      logger.warn('[EVOLUTION] No memory provider available, skipping scheduling.');
      return undefined;
    }
    const actionId = `eve_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const pending: PendingEvolution = {
      actionId,
      agentId: params.agentId,
      action: params.action,
      reason: params.reason,
      toolName: params.toolName,
      args: params.args,
      resource: params.resource,
      traceId: params.traceId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      teamId: params.teamId,
      staffId: params.staffId,
      createdAt: now,
      expiresAt: now + params.timeoutMs,
      status: 'pending',
    };

    await this.base.putItem({
      ...pending,
      userId: `${EVOLUTION_PREFIX}${actionId}`,
      timestamp: 0,
      type: 'PENDING_EVOLUTION',
    });

    logger.info(
      `[EVOLUTION] Scheduled Class C action ${actionId} for proactive evolution in ${params.timeoutMs}ms`
    );
    return actionId;
  }

  /**
   * Finds all pending actions that have timed out and triggers them.
   */
  async triggerTimedOutActions(): Promise<number> {
    if (!this.base) {
      logger.warn('[EVOLUTION] No memory provider available, skipping trigger.');
      return 0;
    }
    const now = Date.now();

    // Query pending evolutions using the TypeTimestampIndex GSI
    const items = await this.base.queryItems({
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#tp = :type',
      FilterExpression: '#status = :pending AND expiresAt <= :now',
      ExpressionAttributeNames: {
        '#tp': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'PENDING_EVOLUTION',
        ':pending': 'pending',
        ':now': now,
      },
    });

    const toTrigger = items as unknown as PendingEvolution[];
    let count = 0;

    for (const action of toTrigger) {
      try {
        await this.triggerProactiveEvolution(action);
        count++;
      } catch (error) {
        logger.error(`[EVOLUTION] Failed to trigger action ${action.actionId}:`, error);
      }
    }

    return count;
  }

  /**
   * Emit the proactive evolution event and mark as triggered.
   */
  private async triggerProactiveEvolution(action: PendingEvolution): Promise<void> {
    logger.info(
      `[EVOLUTION] Triggering proactive evolution for ${action.actionId} (Timeout reached)`
    );

    const originalTask = `Execute tool ${action.toolName || action.action} with args ${action.args ? JSON.stringify(action.args) : '{}'}`;

    await emitTypedEvent('evolution.scheduler', EventType.STRATEGIC_TIE_BREAK, {
      userId: action.userId || 'SYSTEM',
      workspaceId: action.workspaceId,
      orgId: action.orgId,
      teamId: action.teamId,
      staffId: action.staffId,
      agentId: action.agentId,
      task: `Proactive evolution for: ${action.action} (Reason: ${action.reason})`,
      originalTask,
      traceId: action.traceId,
      sessionId: action.traceId,
      metadata: {
        actionId: action.actionId,
        proactive: true,
        originalAction: action.action,
        toolName: action.toolName,
        args: action.args,
        resource: action.resource,
      },
    });

    // Update status to triggered
    action.status = 'triggered';
    if (this.base) {
      await this.base.putItem({
        ...action,
        userId: `${EVOLUTION_PREFIX}${action.actionId}`,
        timestamp: 0,
        type: 'PENDING_EVOLUTION',
      });
    }
  }

  /**
   * Handle human approval/rejection.
   */
  async updateStatus(
    actionId: string,
    status: 'approved' | 'rejected',
    workspaceId?: string
  ): Promise<void> {
    if (!this.base) return;
    const items = await this.base.queryItems({
      KeyConditionExpression: 'userId = :userId AND #timestamp = :zero',
      ExpressionAttributeNames: { '#timestamp': 'timestamp' },
      ExpressionAttributeValues: {
        ':userId': `${EVOLUTION_PREFIX}${actionId}`,
        ':zero': 0,
      },
    });

    if (items.length === 0) return;

    const action = items[0] as unknown as PendingEvolution;

    if (workspaceId && action.workspaceId && action.workspaceId !== workspaceId) {
      logger.warn(`[EVOLUTION] Unauthorized updateStatus attempt for ${actionId}`);
      throw new Error('Unauthorized access to pending evolution');
    }

    action.status = status;

    await this.base.putItem({
      ...action,
      userId: `${EVOLUTION_PREFIX}${actionId}`,
      timestamp: 0,
      type: 'PENDING_EVOLUTION',
    });
  }
}
