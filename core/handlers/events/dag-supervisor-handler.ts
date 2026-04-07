import { EventType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { aggregator } from '../../lib/agent/parallel-aggregator';
import {
  buildDependencyGraph,
  completeTask,
  failTask,
  getReadyTasks,
  isExecutionComplete,
  getExecutionSummary,
  createTaskWithDependencyContext,
} from '../../lib/agent/dag-executor';
import { emitTypedEvent } from '../../lib/utils/typed-emit';
import { EVENT_SCHEMA_MAP } from '../../lib/schema/events';
import { DAGExecutionState } from '../../lib/types/dag';
import { ParallelTaskDefinition } from '../../lib/agent/schema';

/**
 * DAG Supervisor Handler.
 * Specialized coordinator for dependency-aware parallel agent workflows.
 * Handles graph state transitions and dispatches dependent tasks.
 */
export async function handleDagStep(
  eventDetail: Record<string, unknown>,
  detailType: string
): Promise<void> {
  const { userId, traceId, taskId, response, error } = eventDetail;
  const depth = (eventDetail.depth as number) ?? 0;
  const isFailure = detailType === 'DAG_TASK_FAILED';

  if (!userId || !traceId || !taskId) {
    logger.error('DAG Supervisor: Missing required fields in event', { userId, traceId, taskId });
    return;
  }

  logger.info(`DAG Supervisor: Processing step completion for task ${taskId} in trace ${traceId}`);

  const MAX_RETRIES = 5;
  let attempt = 0;
  let success = false;

  while (attempt < MAX_RETRIES && !success) {
    attempt++;
    const currentState = await aggregator.getState(userId as string, traceId as string);
    if (!currentState) {
      logger.error(`DAG Supervisor: No state found for trace ${traceId}`);
      break;
    }

    const currentMetadata = (currentState.metadata as Record<string, unknown>) ?? {};
    let dagState = currentMetadata.dagState as DAGExecutionState | undefined;

    if (!dagState) {
      logger.warn(`DAG Supervisor: No DAG state found for trace ${traceId}, reconstructing.`);
      const tasks = (currentMetadata.tasks as ParallelTaskDefinition[]) ?? [];
      dagState = buildDependencyGraph(tasks);

      // Re-apply completed tasks from sharded results if necessary
      for (const res of currentState.results) {
        if (res.status === 'success') {
          completeTask(dagState, res.taskId, res.result);
        } else if (res.status === 'failed') {
          failTask(dagState, res.taskId, res.error || 'Unknown error');
        }
      }
    }

    // Deep copy to prevent mutation during retries
    const newDagState = JSON.parse(JSON.stringify(dagState)) as DAGExecutionState;

    if (isFailure) {
      failTask(newDagState, taskId as string, (error as string) || 'Task failed');
    } else {
      completeTask(newDagState, taskId as string, response);
    }

    const readyTasks = getReadyTasks(newDagState);
    const expectedVersion = currentState.version ?? 1;

    const updateSuccess = await aggregator.updateDagState(
      userId as string,
      traceId as string,
      newDagState,
      expectedVersion
    );

    if (updateSuccess) {
      success = true;
      logger.info(
        `DAG Supervisor: State updated for ${traceId}. Ready tasks: ${readyTasks.length}`
      );

      // 1. Dispatch new ready tasks
      if (readyTasks.length > 0) {
        await Promise.all(
          readyTasks.map(async (task) => {
            const enrichedTask = createTaskWithDependencyContext(
              task,
              newDagState.outputs as Record<string, unknown>
            );

            let taskDetailType: string = `${task.agentId}_task`;
            if (!EVENT_SCHEMA_MAP[taskDetailType as EventType]) {
              taskDetailType = EventType.CODER_TASK;
            }

            await emitTypedEvent('agent.dag', taskDetailType as EventType, {
              userId: userId as string,
              taskId: task.taskId,
              task: enrichedTask,
              metadata: { ...task.metadata, parallelDispatchId: traceId, dagExecution: true },
              traceId,
              initiatorId: currentState.initiatorId ?? 'dag-supervisor',
              depth: depth + 1,
              sessionId: currentState.sessionId,
            });
          })
        );
      }

      // 2. Check for overall completion
      if (isExecutionComplete(newDagState)) {
        const summary = getExecutionSummary(newDagState);
        logger.info(
          `DAG Supervisor: Execution complete for ${traceId}. ${summary.completed} succeeded, ${summary.failed} failed.`
        );

        const overallStatus = summary.failed > 0 ? 'partial' : 'success';
        const marked = await aggregator.markAsCompleted(
          userId as string,
          traceId as string,
          overallStatus
        );

        if (marked) {
          // Re-fetch state to get all sharded results for the final event
          const finalState = await aggregator.getState(userId as string, traceId as string);

          await emitTypedEvent('events.handler', EventType.PARALLEL_TASK_COMPLETED, {
            userId,
            sessionId: currentState.sessionId,
            traceId,
            taskId: traceId,
            initiatorId: currentState.initiatorId,
            depth,
            overallStatus,
            results: finalState?.results ?? [],
            taskCount: currentState.taskCount,
            completedCount: summary.completed + summary.failed,
            elapsedMs: Date.now() - (currentState.createdAt || Date.now()),
            aggregationType: currentState.aggregationType,
            aggregationPrompt: currentState.aggregationPrompt,
          });
        }
      }
    } else {
      logger.warn(
        `DAG Supervisor: Conflict updating state for ${traceId}, retry ${attempt}/${MAX_RETRIES}`
      );
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
    }
  }

  if (!success && attempt >= MAX_RETRIES) {
    logger.error(`DAG Supervisor: Failed to update state for ${traceId} after max retries.`);
  }
}
