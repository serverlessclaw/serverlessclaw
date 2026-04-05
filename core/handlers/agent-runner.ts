import { TraceSource, TaskEvent, Attachment, AgentType } from '../lib/types/agent';
import { SWARM } from '../lib/constants/system';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  extractBaseUserId,
  detectFailure,
  isTaskPaused,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

interface WorkerEvent {
  'detail-type': string;
  detail: TaskEvent;
}

/**
 * Agent Runner handler. Dynamically loads agent configurations and executes tasks.
 *
 * @param event - The event containing agentId, userId, and task details.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the worker's response string, or undefined on error.
 */
export async function handler(event: WorkerEvent, context: Context): Promise<string | undefined> {
  logger.info('Agent Runner received event:', JSON.stringify(event, null, 2));

  // Extract agentId from the event source or detail-type
  // Pattern: dynamic_<agentId>_task
  const detailType = event['detail-type'] || '';

  if (!detailType.startsWith('dynamic_')) {
    logger.info('Skipping non-dynamic event in Agent Runner:', detailType);
    return;
  }

  const agentId = detailType.replace('dynamic_', '').replace('_task', '');
  const payload = extractPayload<TaskEvent>(event.detail);
  const { userId, task, isContinuation, traceId, taskId, sessionId } = payload;

  if (!validatePayload({ userId, task }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 1. Discovery & Initialization (config + context loaded in parallel)
  const { config, agent } = await initAgent(agentId);

  const isSocial = config?.category === 'social';
  const isTextMode = config?.defaultCommunicationMode === 'text';
  const shouldSpeakDirectly = isSocial || isTextMode;

  // 3. Execution & Streaming
  let finalResponseText = '';
  let finalAttachments: Attachment[] | undefined = undefined;

  const processOptions = buildProcessOptions({
    isContinuation,
    isIsolated: true,
    initiatorId: payload.initiatorId,
    depth: payload.depth,
    traceId,
    taskId,
    sessionId,
    source: TraceSource.SYSTEM,
    context,
    communicationMode: config?.defaultCommunicationMode,
  });

  if (shouldSpeakDirectly) {
    logger.info(`Agent Runner [${agentId}] starting stream for direct communication...`);
    const stream = agent.stream(userId, task, processOptions);
    for await (const chunk of stream) {
      if (chunk.content) {
        finalResponseText += chunk.content;
      }
    }
  } else {
    const processResult = await agent.process(userId, task, processOptions);
    finalResponseText = processResult.responseText;
    finalAttachments = processResult.attachments;

    // Swarm Self-Organization: Decompose high-level plans into parallel sub-tasks
    // This allows orchestrators like SuperClaw to automatically fan-out complex instructions.
    const isAggregation = finalResponseText.includes('[AGGREGATED_RESULTS]');
    const hasMissionMarkers =
      finalResponseText.includes('### Goal:') || finalResponseText.includes('### Step');

    const isPaused = isTaskPaused(finalResponseText);

    if (
      !isContinuation &&
      !isAggregation &&
      !isPaused &&
      (payload.depth ?? 0) < SWARM.MAX_RECURSIVE_DEPTH &&
      (hasMissionMarkers || finalResponseText.length > 800)
    ) {
      const { decomposePlan } = await import('../lib/agent/decomposer');
      const decomposed = decomposePlan(
        finalResponseText,
        traceId || `plan-${Date.now()}`,
        [], // Gaps are usually handled by Coder specifically, but we can pass them if available
        {
          defaultAgentId: AgentType.CODER,
          maxSubTasks: SWARM.DEFAULT_MAX_SUB_TASKS,
        }
      );

      if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
        logger.info(
          `[AgentRunner] Mission detected from ${agentId}. Decomposing into ${decomposed.subTasks.length} parallel tasks.`
        );

        const { emitTypedEvent } = await import('../lib/utils/typed-emit');
        const { EventType } = await import('../lib/types/agent');

        const subTaskEvents = decomposed.subTasks.map((sub) => ({
          taskId: sub.subTaskId,
          agentId: sub.agentId,
          task: sub.task,
          metadata: {
            ...payload.metadata,
            traceId: traceId ?? sub.planId,
            gapIds: sub.gapIds,
            subTaskId: sub.subTaskId,
            planId: sub.planId,
          },
        }));

        try {
          await emitTypedEvent(agentId as AgentType, EventType.PARALLEL_TASK_DISPATCH, {
            userId: baseUserId,
            tasks: subTaskEvents,
            barrierTimeoutMs: 15 * 60 * 1000, // 15 mins default for swarm
            aggregationType: 'agent_guided',
            aggregationPrompt: `I have completed the parallel execution of the mission: "${finalResponseText.substring(0, 200)}...". 
                               Please synthesize the results and provide a final summary.
                               Prepend the result with [AGGREGATED_RESULTS].`,
            initialQuery: payload.task,
            traceId,
            initiatorId: agentId,
            depth: (payload.depth ?? 0) + 1,
            sessionId,
          });

          // Return a PAUSED signal so the user knows we are working in the background
          const pausedResponse = `TASK_PAUSED: I have decomposed this mission into ${decomposed.subTasks.length} parallel sub-tasks. I will notify you once the swarm completes the execution and I've synthesized the results.`;

          // Emit the notification of decomposition
          await emitTaskEvent({
            source: `${agentId}.runner`,
            agentId: agentId as AgentType,
            userId: baseUserId,
            task,
            response: pausedResponse,
            traceId,
            taskId,
            sessionId,
            initiatorId: payload.initiatorId,
            depth: payload.depth,
            userNotified: true,
          });

          return pausedResponse;
        } catch (dispatchError) {
          logger.error(`[AgentRunner] Failed to dispatch mission tasks:`, dispatchError);
          // Fall through to normal response if dispatch fails
        }
      }
    }
  }

  logger.info(`Agent Runner [${agentId}] completed task:`, finalResponseText);

  // 4. Notification
  if (!isTaskPaused(finalResponseText)) {
    const isFailure = detectFailure(finalResponseText);

    // If we streamed, the chunks were already emitted to the bus by the AgentEmitter.
    // We only need to emit the OUTBOUND_MESSAGE if we didn't stream but should have (fallback),
    // or if we want to ensure the final state is synced.
    // Since stream() already emits outbound_message with the final chunks, we can skip it here to avoid duplication.
    if (shouldSpeakDirectly && !isFailure) {
      // Only send the final outbound message if we didn't stream it,
      // but since we *did* stream it, we omit the duplicate sendOutboundMessage call here.
      // The agent's AgentEmitter handles emitting chunks as outbound_messages.
      logger.info(
        `Agent Runner [${agentId}] streaming completed, skipping duplicate final outbound message.`
      );
    }

    await emitTaskEvent({
      source: `${agentId}.agent`,
      agentId,
      userId: baseUserId,
      task,
      [isFailure ? 'error' : 'response']: finalResponseText,
      attachments: finalAttachments,
      traceId,
      taskId,
      sessionId,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      userNotified: shouldSpeakDirectly && !isFailure,
      idempotencyKey: traceId,
    });
  }

  return finalResponseText;
}
