/**
 * Evolution Scheduler for Class C pending actions.
 * Tracks actions that require human approval and triggers proactive evolution after a timeout.
 */
import { logger } from '../logger';
import { BaseMemoryProvider } from '../memory/base';
import { EventType } from '../types/agent';
import { emitTypedEvent } from '../utils/typed-emit';
import { MEMORY_KEYS } from '../constants';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface PendingEvolution {
  actionId: string;
  agentId: string;
  action: string;
  reason: string;
  toolName?: string;
  args?: Record<string, unknown>;
  resource?: string;
  traceId?: string;
  userId: string; // Required for auditing
  workspaceId: string; // Required for multi-tenancy
  orgId?: string;
  teamId?: string;
  staffId?: string;
  createdAt: number;
  expiresAt: number;
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
    userId: string;
    workspaceId: string;
    toolName?: string;
    args?: Record<string, unknown>;
    resource?: string;
    traceId?: string;
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
    const pk = `${MEMORY_KEYS.EVOLUTION_PREFIX}${actionId}`;
    const scopedUserId = this.base.getScopedUserId(pk, { workspaceId: params.workspaceId });

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

    await this.base.putItem(
      {
        ...pending,
        userId: scopedUserId,
        timestamp: 0,
        type: 'PENDING_EVOLUTION',
      },
      { ConditionExpression: 'attribute_not_exists(userId)' }
    );

    logger.info(
      `[EVOLUTION] Scheduled Class C action ${actionId} for proactive evolution (WS: ${params.workspaceId})`
    );
    return actionId;
  }

  /**
   * Finds all pending actions that have timed out and triggers them.
   * Requirement: workspaceId MUST be provided to prevent cross-tenant execution.
   */
  async triggerTimedOutActions(workspaceId: string): Promise<number> {
    if (!this.base) {
      logger.warn('[EVOLUTION] No memory provider available, skipping trigger.');
      return 0;
    }
    if (!workspaceId) {
      logger.error('[EVOLUTION] Mandatory workspaceId missing in triggerTimedOutActions');
      return 0;
    }
    const now = Date.now();

    // Query pending evolutions using the WorkspaceTypeIndex GSI for efficient scoped lookup
    const items = await this.base.queryItems({
      IndexName: 'WorkspaceTypeIndex',
      KeyConditionExpression: 'workspaceId = :ws AND #tp = :type',
      FilterExpression: '#status = :pending AND expiresAt <= :now',
      ExpressionAttributeNames: {
        '#tp': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':ws': workspaceId,
        ':type': 'PENDING_EVOLUTION',
        ':pending': 'pending',
        ':now': now,
      },
    });

    const toTrigger = items as unknown as PendingEvolution[];
    let count = 0;

    for (const action of toTrigger) {
      try {
        // Enforce Principle 13 (Atomic State Integrity)
        const claimed = await this.claimActionForTrigger(action);
        if (claimed) {
          await this.triggerProactiveEvolution(action);
          count++;
        }
      } catch (error) {
        logger.error(`[EVOLUTION] Failed to trigger action ${action.actionId}:`, error);
      }
    }

    return count;
  }

  /**
   * Atomically claims an action for triggering by updating its status to 'triggered'.
   * Prevents race conditions where multiple processes could trigger the same action.
   */
  private async claimActionForTrigger(action: PendingEvolution): Promise<boolean> {
    if (!this.base) return false;
    const pk = `${MEMORY_KEYS.EVOLUTION_PREFIX}${action.actionId}`;
    const scopedUserId = this.base.getScopedUserId(pk, { workspaceId: action.workspaceId });
    const tableName = this.base.getTableName();

    if (!tableName) return false;

    try {
      await this.base.getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: scopedUserId, timestamp: 0 },
          UpdateExpression: 'SET #status = :triggered, triggeredAt = :now',
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':triggered': 'triggered',
            ':pending': 'pending',
            ':now': Date.now(),
          },
        })
      );
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        logger.debug(`[EVOLUTION] Action ${action.actionId} already claimed or status changed.`);
        return false;
      }
      throw e;
    }
  }

  /**
   * Emit the proactive evolution event.
   * Note: Status is now updated BEFORE calling this method via claimActionForTrigger.
   */
  private async triggerProactiveEvolution(action: PendingEvolution): Promise<void> {
    logger.info(
      `[EVOLUTION] Triggering proactive evolution for ${action.actionId} (Timeout reached)`
    );

    const originalTask = `Execute tool ${action.toolName || action.action} with args ${action.args ? JSON.stringify(action.args) : '{}'}`;

    // Sh8 Fix: Fetch collaboration context if applicable
    let contextSummary: string | undefined;
    if (action.traceId) {
      try {
        const { BaseMemoryProvider } = await import('../memory/base');
        const { getCollaboration } = await import('../memory/collaboration-operations');
        const mem = new BaseMemoryProvider();
        const collab = await getCollaboration(mem, action.traceId, {
          workspaceId: action.workspaceId,
        });
        if (collab) {
          contextSummary = `[Collab Context]: ${collab.name} - ${collab.description || 'No description'}`;
        }
      } catch {
        // Silently skip if summary cannot be retrieved
      }
    }

    const idempotencyKey = `eve-trigger:${action.actionId}`;
    await emitTypedEvent(
      'evolution.scheduler',
      EventType.STRATEGIC_TIE_BREAK,
      {
        userId: action.userId || 'SYSTEM',
        workspaceId: action.workspaceId,
        orgId: action.orgId,
        teamId: action.teamId,
        staffId: action.staffId,
        agentId: action.agentId,
        task: `Proactive evolution for: ${action.action} (Reason: ${action.reason}) ${contextSummary ? `\n\n${contextSummary}` : ''}`,
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
      },
      { idempotencyKey }
    );
  }

  /**
   * Handle human approval/rejection.
   * Sh6 Fix: Use atomic UpdateCommand to prevent direct object overwrite.
   */
  async updateStatus(
    actionId: string,
    status: 'approved' | 'rejected',
    workspaceId?: string
  ): Promise<void> {
    if (!this.base) return;
    const pk = `${MEMORY_KEYS.EVOLUTION_PREFIX}${actionId}`;
    const scopedUserId = this.base.getScopedUserId(pk, { workspaceId });
    const tableName = this.base.getTableName();

    if (!tableName) return;

    try {
      await this.base.getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: scopedUserId, timestamp: 0 },
          UpdateExpression: 'SET #status = :status, updatedAt = :now',
          // Optional: only allow updates if currently pending or triggered
          ConditionExpression: '#status IN (:pending, :triggered)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': status,
            ':pending': 'pending',
            ':triggered': 'triggered',
            ':now': Date.now(),
          },
        })
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        logger.warn(`[EVOLUTION] Failed to update status for ${actionId}: already processed.`);
        return;
      }
      throw e;
    }
  }
}
