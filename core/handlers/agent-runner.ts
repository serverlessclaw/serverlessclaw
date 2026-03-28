import { TraceSource, TaskEvent, EventType, Attachment } from '../lib/types/agent';
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
  // Pattern: <agentId>_task
  const detailType = event['detail-type'] || '';

  // Safety list of system events that the Worker should NEVER try to process as an agent
  const systemEvents = [
    EventType.CONTINUATION_TASK,
    EventType.TASK_COMPLETED,
    EventType.TASK_FAILED,
    EventType.OUTBOUND_MESSAGE,
    EventType.SYSTEM_BUILD_FAILED,
    EventType.SYSTEM_BUILD_SUCCESS,
    EventType.CODER_TASK_COMPLETED,
    EventType.MONITOR_BUILD,
    EventType.RECOVERY_LOG,
    EventType.SYSTEM_HEALTH_REPORT,
  ];

  if (!detailType || (systemEvents as string[]).includes(detailType)) {
    logger.info('Skipping system event in Agent Runner:', detailType);
    return;
  }

  const agentId = detailType.replace('_task', '');
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
    });
  }

  return finalResponseText;
}
