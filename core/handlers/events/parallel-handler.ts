import { EventBridgeEvent } from 'aws-lambda';
import { EventType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { ParallelDispatchParams } from '../../lib/agent/schema';

interface ParallelTaskEvent {
  userId: string;
  sessionId?: string;
  traceId?: string;
  initiatorId?: string;
  depth?: number;
  tasks: ParallelDispatchParams['tasks'];
  barrierTimeoutMs?: number;
}

const BARRIER_TIMEOUT_MS = 300000;

export async function handleParallelDispatch(
  event: EventBridgeEvent<string, ParallelTaskEvent>
): Promise<void> {
  const { userId, tasks, barrierTimeoutMs, traceId, initiatorId, depth, sessionId } = event.detail;

  logger.info(
    `Parallel dispatch: ${tasks.length} tasks, timeout=${barrierTimeoutMs ?? BARRIER_TIMEOUT_MS}ms`
  );

  if (!tasks || tasks.length === 0) {
    logger.warn('Parallel dispatch received with no tasks');
    return;
  }

  // 1. Initialize Aggregator State
  const { aggregator } = await import('../../lib/agent/parallel-aggregator');
  await aggregator.init(
    userId,
    traceId ?? 'unknown',
    tasks.length,
    initiatorId ?? 'parallel-dispatcher',
    sessionId
  );

  // 2. Dispatch Tasks
  for (const task of tasks) {
    await emitEvent('agent.parallel', `${task.agentId}_task` as EventType, {
      userId,
      task: task.task,
      metadata: { ...task.metadata, parallelDispatchId: traceId }, // Mark as parallel
      traceId,
      initiatorId: initiatorId ?? 'parallel-dispatcher',
      depth: (depth ?? 0) + 1,
      sessionId,
      taskId: task.taskId,
    });
  }

  logger.info(
    `Dispatched ${tasks.length} parallel tasks. Aggregation will happen via task-result-handler.`
  );
}
