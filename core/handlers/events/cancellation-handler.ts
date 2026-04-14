import { EventBridgeEvent } from 'aws-lambda';
import { logger } from '../../lib/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import type { SSTResource } from '../../lib/types/system';
import { TaskCancellation } from '../../lib/agent/schema';
import { emitEvent, EventPriority } from '../../lib/utils/bus';
import { EventType } from '../../lib/types/agent';
import { addTraceStep } from '../../lib/utils/trace-helper';
import { TRACE_TYPES } from '../../lib/constants';
import { SessionStateManager } from '../../lib/session/session-state';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const CANCEL_PREFIX = 'CANCEL#';
const PARALLEL_PREFIX = 'PARALLEL#';
const sessionStateManager = new SessionStateManager();

export async function handleTaskCancellation(
  event: EventBridgeEvent<string, TaskCancellation>
): Promise<void> {
  const { taskId, initiatorId, reason, parallelDispatchId, userId, sessionId, agentId } =
    event.detail as unknown as {
      taskId?: string;
      initiatorId?: string;
      reason?: string;
      parallelDispatchId?: string;
      userId?: string;
      sessionId?: string;
      agentId?: string;
    };

  logger.info(
    `Task cancellation requested: taskId=${taskId}, parallelDispatchId=${parallelDispatchId}, initiatorId=${initiatorId}`
  );

  if (parallelDispatchId && userId) {
    await handleParallelCancellation(userId, parallelDispatchId, initiatorId, reason);
    return;
  }

  if (!taskId || !initiatorId) {
    logger.warn('Task cancellation received with missing required fields');
    return;
  }

  // Trace: Task cancellation event (A7: pass actual traceId)
  await addTraceStep(initiatorId ?? 'cancellation', undefined, {
    type: TRACE_TYPES.CANCELLATION,
    content: {
      taskId,
      initiatorId,
      reason: reason ?? 'No reason provided',
      cancellationType: 'single_task',
    },
    metadata: { event: 'task_cancelled', taskId },
  });

  await setCancellationFlag(taskId, initiatorId, reason);

  // Release distributed session lock if sessionId provided
  if (sessionId && agentId) {
    try {
      await sessionStateManager.releaseProcessing(sessionId, agentId);
      logger.info(`Released session lock for ${sessionId} after task cancellation`);
    } catch (err) {
      logger.warn(`Failed to release session lock for ${sessionId}:`, err);
    }
  }
}

async function handleParallelCancellation(
  userId: string,
  parallelDispatchId: string,
  initiatorId?: string,
  reason?: string
): Promise<void> {
  logger.info(`Handling parallel task cancellation for dispatch ${parallelDispatchId}`);

  try {
    const result = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :uid AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':uid': `${PARALLEL_PREFIX}${userId}#${parallelDispatchId}`,
          ':zero': 0,
        },
      })
    );

    const state = result.Items?.[0];
    if (!state) {
      logger.warn(`No parallel dispatch state found for ${parallelDispatchId}`);
      return;
    }

    const taskMapping = (state.taskMapping as Array<{ taskId: string; agentId: string }>) ?? [];
    logger.info(
      `Cancelling ${taskMapping.length} tasks in parallel dispatch ${parallelDispatchId}`
    );

    for (const task of taskMapping) {
      await setCancellationFlag(task.taskId, initiatorId ?? 'parallel-dispatcher', reason);

      await emitEvent(
        'agent.cancellation',
        EventType.TASK_CANCELLED,
        {
          userId,
          taskId: task.taskId,
          initiatorId: initiatorId ?? 'parallel-dispatcher',
          reason: reason ?? 'Cancelled due to parallel dispatch cancellation',
          agentId: task.agentId,
        },
        { priority: EventPriority.HIGH }
      );
    }

    logger.info(
      `Sent cancellation signals for ${taskMapping.length} tasks in parallel dispatch ${parallelDispatchId}`
    );
  } catch (error) {
    logger.error(`Failed to handle parallel cancellation for ${parallelDispatchId}:`, error);
    throw error;
  }
}

async function setCancellationFlag(
  taskId: string,
  initiatorId: string,
  reason?: string
): Promise<void> {
  await db.send(
    new PutCommand({
      TableName: typedResource.MemoryTable.name,
      Item: {
        userId: `${CANCEL_PREFIX}${taskId}`,
        timestamp: Date.now(),
        type: 'TASK_CANCELLATION',
        initiatorId,
        reason: reason ?? 'No reason provided',
        cancelledAt: Date.now(),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    })
  );

  logger.info(`Cancellation flag set for task ${taskId}`);
}

export async function isTaskCancelled(taskId: string): Promise<boolean> {
  try {
    const result = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': `${CANCEL_PREFIX}${taskId}`,
        },
      })
    );
    return (result.Items?.length ?? 0) > 0;
  } catch (error) {
    logger.warn('Failed to check task cancellation', { taskId, error });
    return false;
  }
}
