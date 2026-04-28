import { EventType, AgentType, UserRole } from '../../lib/types/index';
import { COMPLETION_EVENT_SCHEMA, FAILURE_EVENT_SCHEMA } from '../../lib/schema/events';
import { wakeupInitiator } from './shared';
import { LRUSet } from '../../lib/utils/lru';
import { getRecursionLimit } from '../../lib/recursion-tracker';
import { routeToDlq } from '../route-to-dlq';
import { emitMetrics, METRICS } from '../../lib/metrics';
import { AgentRegistry } from '../../lib/registry/AgentRegistry';
import * as crypto from 'crypto';

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

  // 1. Stable Content Idempotency (Sh6 Fix)
  // Derive a stable hash from the content to catch application-level double-emissions
  const stablePayload = { ...eventDetail };
  delete (stablePayload as Record<string, unknown>).__envelopeId; // Exclude volatile metadata
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(stablePayload) + detailType)
    .digest('hex')
    .substring(0, 16);

  // Preference order:
  // 1. Explicit idempotencyKey
  // 2. EventBridge envelope ID (__envelopeId or root event.id)
  // 3. Detail payload ID (common in tests/legacy)
  // 4. Stable content hash (final guard)
  const idempotencyKey =
    (eventDetail.idempotencyKey as string) ||
    (eventDetail.__envelopeId as string) ||
    (event.id as string) ||
    (eventDetail.id as string) ||
    contentHash;

  if (processedEvents.has(idempotencyKey)) {
    logger.info(`Duplicate event ${idempotencyKey} detected in-memory, skipping.`);
    import('../../lib/metrics/evolution-metrics').then(({ EVOLUTION_METRICS }) => {
      EVOLUTION_METRICS.recordDuplicateSuppression('task-result-in-memory');
    });
    return;
  }
  processedEvents.add(idempotencyKey);

  // DynamoDB durable dedup for cold-start resilience
  const isFirstProcessing = await checkAndMarkProcessed(idempotencyKey);
  if (!isFirstProcessing) {
    logger.info(`Duplicate event ${idempotencyKey} detected in DynamoDB, skipping.`);
    import('../../lib/metrics/evolution-metrics').then(({ EVOLUTION_METRICS }) => {
      EVOLUTION_METRICS.recordDuplicateSuppression('task-result-dynamodb');
    });
    return;
  }

  const isFailure = detailType === EventType.TASK_FAILED;
  const parsedEvent = isFailure
    ? FAILURE_EVENT_SCHEMA.parse(eventDetail)
    : COMPLETION_EVENT_SCHEMA.parse(eventDetail);

  const {
    userId,
    agentId,
    task,
    traceId,
    initiatorId,
    depth,
    sessionId,
    userNotified,
    workspaceId,
    teamId,
    staffId,
    userRole,
  } = parsedEvent;
  const response = 'error' in parsedEvent ? parsedEvent.error : parsedEvent.response;

  // Defense-in-depth: Validate recursion depth before processing (P1 fix)
  // The depth should have been checked at the entry point, but verify to prevent bypass.
  // Use general recursion limit (task results aren't mission-critical themselves).
  const recursionLimit = await getRecursionLimit({ isMissionContext: false });
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
    updateReputation(memBase, agentId, !isFailure, latencyMs, {
      scope: { workspaceId, teamId, staffId },
      traceId: traceId || '',
    }).catch((err: unknown) => logger.warn(`Reputation update failed for ${agentId}:`, err));
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

    const existingState = await aggregator.getState(userId, traceId, workspaceId);
    if (!existingState) {
      logger.info(`No parallel dispatch state for traceId ${traceId}, skipping aggregation.`);
    } else {
      const metadata = existingState.metadata as Record<string, unknown> | undefined;
      const isDagExecution = metadata?.hasDependencies === true;
      const taskId = (eventDetail.taskId as string) ?? agentId;

      // Retry logic: for failed parallel tasks, attempt once with an alternative agent
      if (isFailure) {
        const retryDispatched = await handleParallelTaskRetry({
          userId,
          traceId,
          taskId,
          agentId,
          response,
          existingState,
          sessionId,
          depth,
          workspaceId,
          teamId,
          staffId,
        });
        if (retryDispatched) {
          return; // Retry dispatched; wait for retry result before aggregating
        }
      }

      // Add result incrementally (handles sharding automatically)
      const aggregateState = await aggregator.addResult(
        userId,
        traceId,
        {
          taskId,
          agentId,
          status: isFailure ? 'failed' : 'success',
          result: response,
          durationMs: 0,
          patch: (eventDetail.metadata as Record<string, unknown>)?.patch as string | undefined,
        },
        workspaceId
      );

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
            workspaceId,
            teamId,
            staffId,
            userRole,
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

        // Emit parallel dispatch completion metric (P3: telemetry)
        emitMetrics([
          METRICS.parallelDispatchCompleted(
            traceId,
            aggregateState.taskCount,
            successCount,
            overallStatus,
            { workspaceId, teamId, staffId }
          ),
        ]).catch(() => {});

        // Atomic completion check to prevent double-firing
        const marked = await aggregator.markAsCompleted(
          userId,
          traceId,
          overallStatus,
          workspaceId
        );

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
            workspaceId,
            teamId,
            staffId,
          });
        }
      }
      return;
    }
  }

  /**
   * Attempts to retry a failed parallel sub-task with an alternative agent.
   * Returns true if a retry was dispatched, false if the failure should be recorded.
   */
  async function handleParallelTaskRetry({
    userId,
    traceId,
    taskId,
    agentId,
    response,
    existingState,
    sessionId,
    depth,
    workspaceId,
    teamId,
    staffId,
  }: {
    userId: string;
    traceId: string;
    taskId: string;
    agentId: string;
    response: string;
    existingState: Awaited<
      ReturnType<import('../../lib/agent/parallel-aggregator').ParallelAggregator['getState']>
    >;
    sessionId?: string;
    depth?: number;
    workspaceId?: string;
    teamId?: string;
    staffId?: string;
  }): Promise<boolean> {
    if (!existingState) return false;

    const metadata = existingState.metadata as Record<string, unknown> | undefined;
    const retries = (metadata?.retries as Record<string, number> | undefined) ?? {};
    if (retries[taskId] && retries[taskId] > 0) {
      return false; // Already retried this task once
    }

    // Find the original task definition
    const tasks =
      (metadata?.tasks as
        | Array<{
            taskId: string;
            agentId: string;
            task: string;
            metadata?: Record<string, unknown>;
          }>
        | undefined) ?? [];
    const originalTask = tasks.find((t) => t.taskId === taskId);
    if (!originalTask) return false;

    // Determine alternative agent
    const alternativeAgent = await pickAlternativeAgent(agentId, workspaceId);
    if (!alternativeAgent) return false;

    // Record retry dispatch in aggregator metadata
    const { aggregator } = await import('../../lib/agent/parallel-aggregator');
    await aggregator.updateProgress(userId, traceId, taskId, 0, 'pending', workspaceId);

    // Emit retry task
    const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
    await emitTypedEvent('agent.parallel', `${alternativeAgent}_task` as EventType, {
      userId,
      taskId: `${taskId}__retry`,
      task: `[RETRY of ${agentId}] ${originalTask.task}\n\nPrevious failure:\n${response}`,
      metadata: {
        ...originalTask.metadata,
        parallelDispatchId: traceId,
        isRetry: true,
        originalTaskId: taskId,
        originalAgentId: agentId,
      },
      traceId,
      initiatorId: 'parallel-retry-dispatcher',
      depth: (depth ?? 0) + 1,
      sessionId,
      workspaceId,
      teamId,
      staffId,
    });

    // Also update the retry count in the aggregator metadata atomically
    // Using updateProgress to store retry state as a lightweight metadata update
    await aggregator.updateProgress(userId, traceId, `${taskId}_retry`, 1, 'pending', workspaceId);

    return true;
  }

  /**
   * Picks an alternative agent for retrying a failed sub-task.
   */
  async function pickAlternativeAgent(
    failedAgentId: string,
    workspaceId?: string
  ): Promise<string | null> {
    const fallbackChain: Record<string, string[]> = {
      [AgentType.CODER]: [AgentType.CRITIC, AgentType.QA, AgentType.RESEARCHER],
      [AgentType.CRITIC]: [AgentType.QA, AgentType.RESEARCHER, AgentType.CODER],
      [AgentType.QA]: [AgentType.RESEARCHER, AgentType.CODER, AgentType.CRITIC],
      [AgentType.RESEARCHER]: [AgentType.CODER, AgentType.CRITIC, AgentType.QA],
      [AgentType.FACILITATOR]: [AgentType.CRITIC, AgentType.QA],
    };

    const candidates = fallbackChain[failedAgentId] ?? [AgentType.CODER];

    try {
      for (const candidate of candidates) {
        const config = await AgentRegistry.getAgentConfig(candidate, { workspaceId });
        if (config && config.enabled === true) {
          return candidate;
        }
      }
    } catch {
      // Registry may not be available in all environments
    }

    // Fallback: return first candidate without registry check
    return candidates[0] ?? null;
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
    userNotified,
    undefined,
    traceId,
    EventType.CONTINUATION_TASK as unknown as string | undefined,
    workspaceId,
    teamId,
    staffId,
    userRole as UserRole
  );
}
