import { EventType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { emitEvent, EventPriority } from '../../lib/utils/bus';
import { ParallelAggregator } from '../../lib/agent/parallel-aggregator';
import { ConfigManager } from '../../lib/registry/config';

interface BarrierTimeoutEvent {
  userId: string;
  traceId: string;
  initiatorId: string;
  sessionId?: string;
  depth?: number;
  taskCount: number;
}

const aggregator = new ParallelAggregator();

export async function handleParallelBarrierTimeout(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const { userId, traceId, initiatorId, sessionId, taskCount } =
    eventDetail as unknown as BarrierTimeoutEvent;

  logger.info(`Handling parallel barrier timeout: traceId=${traceId}, taskCount=${taskCount}`);

  if (!traceId || !userId) {
    logger.warn('Parallel barrier timeout received with missing traceId or userId');
    return;
  }

  const state = await aggregator.getState(userId, traceId);

  if (!state) {
    logger.warn(`No parallel dispatch state found for ${traceId}, assuming already completed.`);
    return;
  }

  const completedCount = (state.completedCount as number) ?? 0;
  const totalTasks = (state.taskCount as number) ?? taskCount ?? 0;

  if (completedCount >= totalTasks) {
    logger.info(
      `Parallel dispatch ${traceId} already completed (${completedCount}/${totalTasks}), ignoring barrier timeout.`
    );
    return;
  }

  const threshold =
    ((await ConfigManager.getRawConfig('parallel_partial_success_threshold')) as number) ?? 0.5;

  const existingResults =
    (state.results as Array<{
      taskId: string;
      status: string;
      agentId: string;
      result?: string | null;
      error?: string | null;
    }>) ?? [];
  const completedTasks = new Set(existingResults.map((r) => r.taskId));
  const taskMapping = (state.taskMapping as Array<{ taskId: string; agentId: string }>) ?? [];

  const finalSuccessCount = existingResults.filter((r) => r.status === 'success').length;
  const finalSuccessRate = totalTasks > 0 ? finalSuccessCount / totalTasks : 0;

  const overallStatus =
    finalSuccessRate === 1 ? 'success' : finalSuccessRate >= threshold ? 'partial' : 'failed';

  // Atomic completion check: seal the dispatch so no more workers can add results
  const marked = await aggregator.markAsCompleted(userId, traceId, overallStatus);

  if (!marked) {
    logger.info(
      `Parallel dispatch ${traceId} already marked as completed or updated, skipping timeout event.`
    );
    return;
  }

  // Now that the dispatch is sealed, synthesize timeout results for the tasks that didn't finish
  const finalResults = [...existingResults];

  for (const mapping of taskMapping) {
    if (completedTasks.has(mapping.taskId)) continue;

    logger.info(`Marking task ${mapping.taskId} as timed out in parallel dispatch ${traceId}`);
    finalResults.push({
      taskId: mapping.taskId,
      agentId: mapping.agentId,
      status: 'timeout',
      result: null,
      error: 'Task timed out due to parallel barrier timeout',
    });
  }

  logger.info(
    `Parallel barrier timeout for ${traceId}: ${finalSuccessCount}/${totalTasks} succeeded (${Math.round(finalSuccessRate * 100)}%), overall status: ${overallStatus}`
  );

  await emitEvent(
    'events.handler',
    EventType.PARALLEL_TASK_COMPLETED,
    {
      userId,
      sessionId,
      traceId,
      initiatorId: initiatorId ?? state.initiatorId ?? 'parallel-dispatcher',
      overallStatus,
      results: finalResults,
      taskCount: totalTasks,
      completedCount: totalTasks, // We consider it fully completed (with timeouts)
      elapsedMs: Date.now() - ((state.createdAt as number) ?? Date.now()),
    },
    { priority: EventPriority.HIGH }
  );
}
