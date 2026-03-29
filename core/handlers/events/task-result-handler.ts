import { EventType, AgentType } from '../../lib/types/index';
import { DAGExecutionState } from '../../lib/types/dag';
import type { ParallelTaskDefinition } from '../../lib/agent/schema';
import { COMPLETION_EVENT_SCHEMA, FAILURE_EVENT_SCHEMA } from '../../lib/schema/events';
import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';

/**
 * In-memory fast-path dedup set for EventBridge's at-least-once delivery.
 * Serves as a hot cache; DynamoDB idempotency is the durable guard for cold starts.
 * Bounded to 10k entries to avoid memory leaks; resets when exceeded.
 */
const processedEvents = new Set<string>();
const DEDUP_MAX_SIZE = 10_000;

/**
 * Checks and marks an event as processed using DynamoDB for cross-invocation dedup.
 * Falls back gracefully if DynamoDB write fails.
 */
async function checkAndMarkProcessed(eventId: string): Promise<boolean> {
  try {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { Resource } = await import('sst');

    const tableName = (Resource as unknown as { MemoryTable: { name: string } }).MemoryTable.name;
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL

    await db.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: `IDEMPOTENCY#task_result:${eventId}`,
          timestamp: Date.now(),
          type: 'IDEMPOTENCY',
          expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(userId)',
      })
    );
    return true; // Successfully marked — this is the first processing
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false; // Already processed
    }
    // If DynamoDB fails, allow processing (fail-open)
    const { logger } = await import('../../lib/logger');
    logger.warn('Idempotency check failed, proceeding:', error);
    return true;
  }
}

/**
 * Handles task completion and failure events - relays results to initiator.
 *
 * @param eventDetail - The detail of the EventBridge event.
 * @param detailType - The type of the EventBridge event.
 * @since 2026-03-19
 */
export async function handleTaskResult(
  eventDetail: Record<string, unknown>,
  detailType: string
): Promise<void> {
  const { logger } = await import('../../lib/logger');

  // In-memory fast-path dedup
  const eventId = eventDetail.id as string | undefined;
  if (eventId) {
    if (processedEvents.has(eventId)) {
      logger.info(`Duplicate event ${eventId} detected in-memory, skipping.`);
      return;
    }
    processedEvents.add(eventId);
    if (processedEvents.size > DEDUP_MAX_SIZE) {
      processedEvents.clear();
    }

    // DynamoDB durable dedup for cold-start resilience
    const isFirstProcessing = await checkAndMarkProcessed(eventId);
    if (!isFirstProcessing) {
      logger.info(`Duplicate event ${eventId} detected in DynamoDB, skipping.`);
      return;
    }
  }

  const isFailure = detailType === EventType.TASK_FAILED;
  const parsedEvent = isFailure
    ? FAILURE_EVENT_SCHEMA.parse(eventDetail)
    : COMPLETION_EVENT_SCHEMA.parse(eventDetail);

  const { userId, agentId, task, traceId, initiatorId, depth, sessionId, userNotified } =
    parsedEvent;
  const response = 'error' in parsedEvent ? parsedEvent.error : parsedEvent.response;

  logger.info(
    `Relaying ${isFailure ? 'failure' : 'completion'} from ${agentId} to Initiator: ${initiatorId} (Depth: ${depth}, Session: ${sessionId}, UserNotified: ${userNotified})`
  );

  // Update agent reputation (fire-and-forget, non-blocking)
  try {
    const { BaseMemoryProvider } = await import('../../lib/memory/base');
    const { updateReputation } = await import('../../lib/memory/reputation-operations');
    const memBase = new BaseMemoryProvider();
    const latencyMs =
      typeof parsedEvent.metadata === 'object' &&
      parsedEvent.metadata !== null &&
      'durationMs' in parsedEvent.metadata
        ? ((parsedEvent.metadata.durationMs as number) ?? 0)
        : 0;
    updateReputation(memBase, agentId, !isFailure, latencyMs).catch((err: unknown) =>
      logger.warn(`Reputation update failed for ${agentId}:`, err)
    );
  } catch {
    // reputation module may not be available in all environments
  }

  // 1. Loop Protection - Use shared function
  const RECURSION_LIMIT = await getRecursionLimit();

  if (depth >= RECURSION_LIMIT) {
    logger.error(`Recursion Limit Exceeded (Depth: ${depth}) for user ${userId}. Aborting.`);
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'task-result-handler',
      `I have detected an infinite loop between agents (Depth: ${depth}). I've intervened to stop the process. Please check the orchestration logic. You can increase this limit in the System Config.`
    );
    return;
  }

  // 2. Dynamic Routing
  // If no initiator is provided, this was likely a background system task (e.g. reflection).
  // We do not wake up anyone in this case to prevent unexpected user-facing messages.
  // Also, prevent the main agent from waking itself up to avoid infinite acknowledgment loops.
  if (
    initiatorId === 'orchestrator' ||
    (agentId === AgentType.SUPERCLAW && initiatorId === AgentType.SUPERCLAW)
  ) {
    logger.info(
      `No continuation needed for ${agentId} task (Initiator: ${initiatorId}). Treating as background completion.`
    );
    return;
  }

  const resultPrefix = isFailure ? 'DELEGATED_TASK_FAILURE' : 'DELEGATED_TASK_RESULT';

  await wakeupInitiator(
    userId,
    initiatorId,
    `${resultPrefix}: Agent '${agentId}' has ${isFailure ? 'failed' : 'completed'} the task: "${task}". 
      ${isFailure ? 'Error' : 'Result'}:
      ---
      ${response}
      ---
      Please continue your logic based on this result.`,
    traceId,
    sessionId,
    depth,
    userNotified
  );

  // 3. Parallel Dispatch Aggregation & DAG Execution
  // Check if this result is part of a parallel dispatch
  // Only attempt aggregation if the parallel tracking record exists (was initialized via parallel-handler)
  if (traceId) {
    const { aggregator } = await import('../../lib/agent/parallel-aggregator');
    const { ConfigManager } = await import('../../lib/registry/config');

    // Guard: check if parallel state exists before attempting to add result.
    // Non-parallel tasks have a traceId but no parallel tracking record.
    const existingState = await aggregator.getState(userId, traceId);
    if (!existingState) {
      logger.info(`No parallel dispatch state for traceId ${traceId}, skipping aggregation.`);
      return;
    }

    // Check if this is a DAG execution with dependencies
    const metadata = existingState.metadata as Record<string, unknown> | undefined;
    const isDagExecution = metadata?.hasDependencies === true;

    if (isDagExecution) {
      // Handle DAG task completion
      const taskId = (eventDetail.taskId as string) ?? agentId;
      logger.info(`DAG task ${taskId} completed. Checking for dependent tasks.`);

      const dagExecutor = await import('../../lib/agent/dag-executor');
      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      const { EVENT_SCHEMA_MAP } = await import('../../lib/schema/events');

      // Add result incrementally
      await aggregator.addResult(userId, traceId, {
        taskId,
        agentId,
        status: isFailure ? 'failed' : 'success',
        result: response,
        durationMs: 0,
      });

      // OCC loop for DAG state update
      const MAX_RETRIES = 5;
      let attempt = 0;
      let success = false;

      while (attempt < MAX_RETRIES && !success) {
        attempt++;
        const currentState = await aggregator.getState(userId, traceId);
        if (!currentState) break;

        const currentMetadata = currentState.metadata ?? {};
        let dagState = currentMetadata.dagState as DAGExecutionState | undefined;

        if (!dagState) {
          logger.warn(`No DAG state found for traceId ${traceId}, reconstructing from tasks.`);
          const tasks = (currentMetadata.tasks as ParallelTaskDefinition[]) ?? [];
          dagState = dagExecutor.buildDependencyGraph(tasks);
        }

        // Deep copy DAG state to prevent reference mutations across retries
        const newDagState = JSON.parse(JSON.stringify(dagState)) as DAGExecutionState;

        if (isFailure) {
          dagExecutor.failTask(newDagState, taskId, response as string);
        } else {
          dagExecutor.completeTask(newDagState, taskId, response);
        }

        const readyTasks = dagExecutor.getReadyTasks(newDagState);
        const expectedVersion = currentState.version ?? 1;

        const updateSuccess = await aggregator.updateDagState(
          userId,
          traceId,
          newDagState,
          expectedVersion
        );

        if (updateSuccess) {
          success = true;

          // Dispatch ready tasks
          if (readyTasks.length > 0) {
            logger.info(
              `DAG: Dispatching ${readyTasks.length} dependent tasks after ${taskId} completion.`
            );
            for (const task of readyTasks) {
              const enrichedTask = dagExecutor.createTaskWithDependencyContext(
                task,
                newDagState.outputs as Record<string, unknown>
              );

              let detailType: string = `${task.agentId}_task`;
              if (!EVENT_SCHEMA_MAP[detailType as EventType]) {
                detailType = EventType.CODER_TASK;
              }

              await emitTypedEvent('agent.dag', detailType as EventType, {
                userId,
                taskId: task.taskId,
                task: enrichedTask,
                metadata: { ...task.metadata, parallelDispatchId: traceId, dagExecution: true },
                traceId,
                initiatorId: currentState.initiatorId ?? 'dag-executor',
                depth: (depth ?? 0) + 1,
                sessionId: currentState.sessionId,
              });
            }
          }

          // Check if DAG execution is complete
          if (dagExecutor.isExecutionComplete(newDagState)) {
            const summary = dagExecutor.getExecutionSummary(newDagState);
            logger.info(
              `DAG execution complete for ${traceId}: ${summary.completed} completed, ${summary.failed} failed.`
            );

            if (summary.pending === 0 && summary.ready === 0) {
              const overallStatus = summary.failed > 0 ? 'partial' : 'success';
              const marked = await aggregator.markAsCompleted(userId, traceId, overallStatus);

              if (marked) {
                const finalState = await aggregator.getState(userId, traceId);
                await emitTypedEvent(
                  'events.handler',
                  EventType.PARALLEL_TASK_COMPLETED as unknown as EventType,
                  {
                    userId,
                    sessionId: currentState.sessionId,
                    traceId,
                    taskId: traceId,
                    initiatorId: currentState.initiatorId,
                    depth,
                    overallStatus,
                    results: finalState?.results ?? [],
                    taskCount: currentState.taskCount,
                    completedCount: summary.completed,
                    elapsedMs: 0,
                    aggregationType: currentState.aggregationType,
                    aggregationPrompt: currentState.aggregationPrompt,
                  }
                );
              }
            }
          }
        } else {
          logger.warn(`DAG state update collision for ${traceId}, retrying (attempt ${attempt})`);
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
        }
      }

      if (!success) {
        logger.error(`Failed to update DAG state for ${traceId} after ${MAX_RETRIES} attempts`);
      }

      return;
    }

    // Standard parallel dispatch (non-DAG)
    const aggregateState = await aggregator.addResult(userId, traceId, {
      taskId: (eventDetail.taskId as string) ?? agentId,
      agentId,
      status: isFailure ? 'failed' : 'success',
      result: response,
      durationMs: 0,
    });

    if (aggregateState?.isComplete) {
      logger.info(`Parallel dispatch ${traceId} complete! Emitting aggregated results.`);

      const threshold =
        ((await ConfigManager.getRawConfig('parallel_partial_success_threshold')) as number) ?? 0.5;
      const successCount = aggregateState.results.filter((r) => r.status === 'success').length;
      const successRate = successCount / aggregateState.taskCount;

      const overallStatus =
        successRate === 1 ? 'success' : successRate >= threshold ? 'partial' : 'failed';

      // Atomic completion check to prevent double-firing with timeout handler
      const marked = await aggregator.markAsCompleted(userId, traceId, overallStatus);

      if (marked) {
        const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
        await emitTypedEvent(
          'events.handler',
          EventType.PARALLEL_TASK_COMPLETED as unknown as EventType,
          {
            userId,
            sessionId: aggregateState.sessionId,
            traceId,
            taskId: traceId, // Use traceId as taskId for the aggregate event
            initiatorId: aggregateState.initiatorId,
            depth: depth,
            overallStatus,
            results: aggregateState.results,
            taskCount: aggregateState.taskCount,
            completedCount: aggregateState.results.length,
            elapsedMs: 0,
            aggregationType: aggregateState.aggregationType,
            aggregationPrompt: aggregateState.aggregationPrompt,
          }
        );
      } else {
        logger.info(`Parallel dispatch ${traceId} already marked as completed, skipping event.`);
      }
    }
  }
}
