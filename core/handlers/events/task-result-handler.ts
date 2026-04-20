import { EventType, AgentType } from '../../lib/types/index';
import { COMPLETION_EVENT_SCHEMA, FAILURE_EVENT_SCHEMA } from '../../lib/schema/events';
import { wakeupInitiator } from './shared';
import { LRUSet } from '../../lib/utils/lru';
import { getRecursionLimit } from '../../lib/recursion-tracker';
import { routeToDlq } from '../route-to-dlq';
import { emitMetrics, METRICS } from '../../lib/metrics';

/**
 * In-memory fast-path dedup set for EventBridge's at-least-once delivery.
 * Serves as a hot cache; DynamoDB idempotency is the durable guard for cold starts.
 * Bounded to 10k entries using LRU to avoid memory leaks.
 */
const DEDUP_MAX_SIZE = 10_000;
const processedEvents = new LRUSet<string>(DEDUP_MAX_SIZE);

/**
 * Checks and marks an event as processed using DynamoDB for cross-invocation dedup.
 * Falls back gracefully if DynamoDB write fails.
 */
async function checkAndMarkProcessed(eventId: string): Promise<boolean> {
  try {
    const [{ DynamoDBClient }, { DynamoDBDocumentClient, PutCommand }, { Resource }] =
      await Promise.all([
        import('@aws-sdk/client-dynamodb'),
        import('@aws-sdk/lib-dynamodb'),
        import('sst'),
      ]);

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
 * Generic handler for task completion and failure events.
 * Relays results back to the initiator via AGENT_TASK_RESULT event.
 *
 * @param event - The full EventBridge event.
 * @param detailType - The type of the EventBridge event.
 * @since 2026-03-19
 */
export async function handleTaskResult(
  event: { 'detail-type': string; detail: Record<string, unknown>; id?: string },
  detailType: string
): Promise<void> {
  const eventDetail = event.detail;
  const { logger } = await import('../../lib/logger');

  // In-memory fast-path dedup — prefer EventBridge envelope id over detail id
  const eventId =
    (eventDetail.__envelopeId as string | undefined) ?? (event.id as string | undefined);
  if (eventId) {
    if (processedEvents.has(eventId)) {
      logger.info(`Duplicate event ${eventId} detected in-memory, skipping.`);
      import('../../lib/metrics/evolution-metrics').then(({ EVOLUTION_METRICS }) => {
        EVOLUTION_METRICS.recordDuplicateSuppression('task-result-in-memory');
      });
      return;
    }
    processedEvents.add(eventId);

    // DynamoDB durable dedup for cold-start resilience
    const isFirstProcessing = await checkAndMarkProcessed(eventId);
    if (!isFirstProcessing) {
      logger.info(`Duplicate event ${eventId} detected in DynamoDB, skipping.`);
      import('../../lib/metrics/evolution-metrics').then(({ EVOLUTION_METRICS }) => {
        EVOLUTION_METRICS.recordDuplicateSuppression('task-result-dynamodb');
      });
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

  // Defense-in-depth: Validate recursion depth before processing (P1 fix)
  // The depth should have been checked at the entry point, but verify to prevent bypass.
  // Use general recursion limit (task results aren't mission-critical themselves).
  const recursionLimit = await getRecursionLimit(false);
  const currentDepth = depth ?? 0;
  if (currentDepth >= recursionLimit) {
    logger.error(
      `[RECURSION] Limit exceeded in task-result-handler: depth=${currentDepth}, limit=${recursionLimit}`
    );
    await routeToDlq(
      event,
      detailType,
      'SYSTEM',
      traceId ?? 'unknown',
      `Recursion limit exceeded (depth:${currentDepth})`
    );
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  logger.info(
    `Relaying ${isFailure ? 'failure' : 'completion'} from ${agentId} to Initiator: ${initiatorId} (Depth: ${depth}, Session: ${sessionId}, UserNotified: ${userNotified})`
  );

  // Update agent reputation (fire-and-forget, non-blocking)
  try {
    const [{ BaseMemoryProvider }, { updateReputation }] = await Promise.all([
      import('../../lib/memory/base'),
      import('../../lib/memory/reputation-operations'),
    ]);
    const memBase = new BaseMemoryProvider();
    const latencyMs =
      typeof parsedEvent.metadata === 'object' &&
      parsedEvent.metadata !== null &&
      'durationMs' in parsedEvent.metadata
        ? ((parsedEvent.metadata.durationMs as number) ?? 0)
        : 0;
    updateReputation(memBase, agentId, !isFailure, latencyMs, parsedEvent.workspaceId).catch(
      (err: unknown) => logger.warn(`Reputation update failed for ${agentId}:`, err)
    );
  } catch {
    // reputation module may not be available in all environments
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

  // 3. Parallel Dispatch Aggregation & DAG Execution
  if (traceId) {
    const [{ aggregator }, { ConfigManager }, { emitTypedEvent }] = await Promise.all([
      import('../../lib/agent/parallel-aggregator'),
      import('../../lib/registry/config'),
      import('../../lib/utils/typed-emit'),
    ]);

    const existingState = await aggregator.getState(userId, traceId);
    if (!existingState) {
      logger.info(`No parallel dispatch state for traceId ${traceId}, skipping aggregation.`);
    } else {
      const metadata = existingState.metadata as Record<string, unknown> | undefined;
      const isDagExecution = metadata?.hasDependencies === true;
      const taskId = (eventDetail.taskId as string) ?? agentId;

      // Add result incrementally (handles sharding automatically)
      const aggregateState = await aggregator.addResult(userId, traceId, {
        taskId,
        agentId,
        status: isFailure ? 'failed' : 'success',
        result: response,
        durationMs: 0,
        patch: (eventDetail.metadata as Record<string, unknown>)?.patch as string | undefined,
      });

      if (isDagExecution) {
        logger.info(`DAG task ${taskId} completed. Triggering DAG Supervisor.`);
        await emitTypedEvent(
          'events.handler',
          isFailure ? EventType.DAG_TASK_FAILED : EventType.DAG_TASK_COMPLETED,
          {
            userId,
            traceId,
            taskId,
            agentId,
            response,
            error: isFailure ? response : undefined,
            sessionId,
            depth,
          }
        );
        return;
      }

      // Standard parallel dispatch (non-DAG)
      if (aggregateState?.isComplete) {
        logger.info(`Parallel dispatch ${traceId} complete! Emitting aggregated results.`);

        const threshold =
          ((await ConfigManager.getRawConfig('parallel_partial_success_threshold')) as number) ??
          0.5;
        const successCount = aggregateState.results.filter((r) => r.status === 'success').length;
        const successRate = successCount / aggregateState.taskCount;

        const overallStatus =
          successRate === 1 ? 'success' : successRate >= threshold ? 'partial' : 'failed';

        // Atomic completion check to prevent double-firing
        const marked = await aggregator.markAsCompleted(userId, traceId, overallStatus);

        if (marked) {
          await emitTypedEvent('events.handler', EventType.PARALLEL_TASK_COMPLETED, {
            userId,
            sessionId: aggregateState.sessionId,
            traceId,
            taskId: traceId,
            initiatorId: aggregateState.initiatorId,
            depth,
            overallStatus,
            results: aggregateState.results,
            taskCount: aggregateState.taskCount,
            completedCount: aggregateState.results.length,
            elapsedMs: Date.now() - (existingState.createdAt || Date.now()),
            aggregationType: aggregateState.aggregationType,
            aggregationPrompt: aggregateState.aggregationPrompt,
          });
        }
      }
      return;
    }
  }

  // Non-parallel task — wake the initiator now
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
}
