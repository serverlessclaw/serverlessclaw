import { EventBridgeEvent } from 'aws-lambda';
import { EventType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { ParallelDispatchParams, ParallelTaskDefinition } from '../../lib/agent/schema';
import { DynamicScheduler } from '../../lib/lifecycle/scheduler';
import { ConfigManager } from '../../lib/registry/config';
import { TIME, TRACE_TYPES } from '../../lib/constants';
import { EVENT_SCHEMA_MAP } from '../../lib/schema/events';
import { addTraceStep } from '../../lib/utils/trace-helper';
import {
  buildDependencyGraph,
  validateDependencyGraph,
  getReadyTasks,
} from '../../lib/agent/dag-executor';

export interface ParallelTaskEvent {
  userId: string;
  sessionId?: string;
  traceId?: string;
  initiatorId?: string;
  depth?: number;
  tasks: ParallelDispatchParams['tasks'];
  barrierTimeoutMs?: number;
  aggregationType?: ParallelDispatchParams['aggregationType'];
  aggregationPrompt?: ParallelDispatchParams['aggregationPrompt'];
}

const DEFAULT_BARRIER_TIMEOUT_MS = TIME.MS_PER_MINUTE * 5;

export async function handleParallelDispatch(
  event: EventBridgeEvent<string, ParallelTaskEvent>
): Promise<void> {
  const {
    userId,
    tasks,
    barrierTimeoutMs,
    traceId,
    initiatorId,
    depth,
    sessionId,
    aggregationType,
    aggregationPrompt,
  } = event.detail;

  const timeoutMs =
    ((await ConfigManager.getRawConfig('parallel_barrier_timeout_ms')) as number) ??
    barrierTimeoutMs ??
    DEFAULT_BARRIER_TIMEOUT_MS;

  logger.info(`Parallel dispatch: ${tasks.length} tasks, timeout=${timeoutMs}ms`);

  if (!tasks || tasks.length === 0) {
    logger.warn('Parallel dispatch received with no tasks');
    return;
  }

  const safeTraceId = traceId ?? `parallel-${Date.now()}`;

  // Check if any tasks have dependencies
  const hasDependencies = tasks.some((t) => t.dependsOn && t.dependsOn.length > 0);

  // Trace: Parallel dispatch initiated
  await addTraceStep(safeTraceId, 'root', {
    type: TRACE_TYPES.PARALLEL_DISPATCH,
    content: {
      taskCount: tasks.length,
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        agentId: t.agentId,
        task: t.task,
        dependsOn: t.dependsOn,
      })),
      aggregationType: aggregationType ?? 'summary',
      barrierTimeoutMs: timeoutMs,
      initiatorId: initiatorId ?? 'parallel-dispatcher',
      depth,
      hasDependencies,
    },
    metadata: { event: 'parallel_dispatch', taskCount: tasks.length },
  });

  const { aggregator } = await import('../../lib/agent/parallel-aggregator');

  // Store tasks and DAG state in metadata for dependency resolution
  const aggregatorMetadata: Record<string, unknown> = {
    tasks,
    hasDependencies,
  };

  // If DAG mode, store the initial DAG state
  if (hasDependencies) {
    const dagState = buildDependencyGraph(tasks);
    aggregatorMetadata.dagState = dagState;
  }

  await aggregator.init(
    userId,
    safeTraceId,
    tasks.length,
    initiatorId ?? 'parallel-dispatcher',
    sessionId,
    tasks.map((t) => ({ taskId: t.taskId, agentId: t.agentId })),
    aggregationType,
    aggregationPrompt,
    aggregatorMetadata
  );

  // If dependencies are enabled, use DAG execution
  if (hasDependencies) {
    logger.info('DAG mode enabled: Tasks have dependencies');

    // Build and validate dependency graph
    const dagState = buildDependencyGraph(tasks);
    const isValid = validateDependencyGraph(dagState);

    if (!isValid) {
      logger.error('Invalid dependency graph (cycle detected). Failing dispatch immediately.');

      // Mark aggregator as failed to prevent hanging barriers
      await aggregator.markAsCompleted(userId, safeTraceId, 'failed');

      // Emit a completion event to notify orchestrator of failure
      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      await emitTypedEvent('events.handler', EventType.PARALLEL_TASK_COMPLETED, {
        userId,
        sessionId,
        traceId: safeTraceId,
        taskId: safeTraceId,
        initiatorId: initiatorId ?? 'parallel-dispatcher',
        depth,
        overallStatus: 'failed',
        results: [],
        taskCount: tasks.length,
        completedCount: 0,
        elapsedMs: 0,
        aggregationType,
        aggregationPrompt,
      });
      return;
    }

    // Get initial ready tasks (no dependencies)
    const readyTasks = getReadyTasks(dagState);

    if (readyTasks.length === 0) {
      logger.error('No tasks ready to execute (all have unsatisfied dependencies)');
      return;
    }

    // Dispatch ready tasks (A6: with error boundary)
    const dagDispatchErrors: Array<{ taskId: string; error: string }> = [];
    for (const task of readyTasks) {
      try {
        await dispatchTask(task, safeTraceId, initiatorId, depth, sessionId, userId);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to dispatch DAG task ${task.taskId}:`, error);
        dagDispatchErrors.push({ taskId: task.taskId, error: errorMsg });
      }
    }

    if (dagDispatchErrors.length > 0) {
      logger.warn(
        `DAG dispatch had ${dagDispatchErrors.length}/${readyTasks.length} failures: ` +
          dagDispatchErrors.map((e) => e.taskId).join(', ')
      );
      // Notify aggregator of dispatch failures (A6 Fix)
      for (const err of dagDispatchErrors) {
        await aggregator.addResult(userId, safeTraceId, {
          taskId: err.taskId,
          agentId: tasks.find((t) => t.taskId === err.taskId)?.agentId || 'unknown',
          status: 'failed',
          error: `Dispatch failed: ${err.error}`,
          durationMs: 0,
        });
      }
    }

    logger.info(
      `DAG mode: Dispatched ${readyTasks.length} initial tasks. ` +
        `${tasks.length - readyTasks.length} tasks waiting for dependencies.`
    );
    return;
  }

  // Standard parallel execution (no dependencies)
  // A6: Wrap each dispatch in try/catch to prevent partial failures
  const dispatchErrors: Array<{ taskId: string; error: string }> = [];
  for (const task of tasks) {
    try {
      await dispatchTask(task, safeTraceId, initiatorId, depth, sessionId, userId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to dispatch parallel task ${task.taskId}:`, error);
      dispatchErrors.push({ taskId: task.taskId, error: errorMsg });
    }
  }

  if (dispatchErrors.length > 0) {
    logger.warn(
      `Parallel dispatch had ${dispatchErrors.length}/${tasks.length} dispatch failures: ` +
        dispatchErrors.map((e) => e.taskId).join(', ')
    );
    // Notify aggregator of dispatch failures (A6 Fix)
    for (const err of dispatchErrors) {
      await aggregator.addResult(userId, safeTraceId, {
        taskId: err.taskId,
        agentId: tasks.find((t) => t.taskId === err.taskId)?.agentId || 'unknown',
        status: 'failed',
        error: `Dispatch failed: ${err.error}`,
        durationMs: 0,
      });
    }
  }

  const targetTime = Date.now() + timeoutMs;
  const timeoutId = `parallel-barrier-${safeTraceId}`;

  try {
    await DynamicScheduler.scheduleOneShotTimeout(
      timeoutId,
      {
        userId,
        traceId: safeTraceId,
        initiatorId: initiatorId ?? 'parallel-dispatcher',
        sessionId,
        depth: depth ?? 0,
        taskCount: tasks.length,
      },
      targetTime,
      EventType.PARALLEL_BARRIER_TIMEOUT
    );
    logger.info(
      `Scheduled parallel barrier timeout for ${timeoutId}: ${new Date(targetTime).toISOString()}`
    );
  } catch (error) {
    logger.error(`Failed to schedule parallel barrier timeout for ${timeoutId}:`, error);

    // Mark aggregator as failed to prevent hanging barriers
    await aggregator.markAsCompleted(userId, safeTraceId, 'failed');

    // Emit a completion event to notify orchestrator of failure
    const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
    await emitTypedEvent('events.handler', EventType.PARALLEL_TASK_COMPLETED, {
      userId,
      sessionId,
      traceId: safeTraceId,
      taskId: safeTraceId,
      initiatorId: initiatorId ?? 'parallel-dispatcher',
      depth,
      overallStatus: 'failed',
      results: [],
      taskCount: tasks.length,
      completedCount: 0,
      elapsedMs: 0,
      aggregationType,
      aggregationPrompt,
    });
    return;
  }

  // Trace: Barrier waiting for sub-agents
  await addTraceStep(safeTraceId, 'root', {
    type: TRACE_TYPES.PARALLEL_BARRIER,
    content: {
      taskCount: tasks.length,
      barrierTimeoutMs: timeoutMs,
      targetTime: new Date(targetTime).toISOString(),
      status: 'waiting_for_sub_agents',
    },
    metadata: { event: 'parallel_barrier', taskCount: tasks.length },
  });

  logger.info(
    `Dispatched ${tasks.length} parallel tasks. Aggregation will happen via task-result-handler.`
  );
}

/**
 * Helper function to dispatch a single task
 */
async function dispatchTask(
  task: ParallelTaskDefinition,
  traceId: string,
  initiatorId: string | undefined,
  depth: number | undefined,
  sessionId: string | undefined,
  userId: string
): Promise<void> {
  const { emitTypedEvent } = await import('../../lib/utils/typed-emit');

  // Resolve correct EventType for the agent
  let detailType: string = `${task.agentId}_task`;

  // Generic fallback for unknown agents to use TASK_EVENT_SCHEMA via CODER_TASK key
  if (!EVENT_SCHEMA_MAP[detailType as EventType]) {
    detailType = EventType.CODER_TASK;
  }

  await emitTypedEvent('agent.parallel', detailType as EventType, {
    userId,
    taskId: task.taskId,
    task: task.task,
    metadata: { ...task.metadata, parallelDispatchId: traceId },
    traceId,
    initiatorId: initiatorId ?? 'parallel-dispatcher',
    depth: (depth ?? 0) + 1,
    sessionId,
  });
}
