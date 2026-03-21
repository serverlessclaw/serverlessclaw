import { TraceSource, TaskEvent, EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  getAgentContext,
  extractPayload,
  detectFailure,
  isTaskPaused,
  loadAgentConfig,
  createAgent,
  validatePayload,
  buildProcessOptions,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

interface WorkerEvent {
  'detail-type': string;
  detail: TaskEvent;
}

/**
 * Worker Agent handler. Dynamically loads agent configurations and executes tasks.
 *
 * @param event - The event containing agentId, userId, and task details.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the worker's response string, or undefined on error.
 */
export async function handler(event: WorkerEvent, context: Context): Promise<string | undefined> {
  logger.info('Worker Agent received event:', JSON.stringify(event, null, 2));

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
    logger.info('Skipping system event in Worker Agent:', detailType);
    return;
  }

  const agentId = detailType.replace('_task', '');
  const payload = extractPayload<TaskEvent>(event.detail);
  const { userId, task, isContinuation, traceId, sessionId } = payload;

  if (!validatePayload({ userId, task }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 1. Discovery: Load dynamic config
  const config = await loadAgentConfig(agentId);

  // 2. Initialization: Setup tools and prompt
  const { memory, provider } = await getAgentContext();
  const agent = await createAgent(agentId, config, memory, provider);

  const isSocial = config?.category === 'social';
  const isTextMode = config?.defaultCommunicationMode === 'text';
  const shouldSpeakDirectly = isSocial || isTextMode;

  // 3. Execution
  const { responseText, attachments: resultAttachments } = await agent.process(
    userId,
    task,
    buildProcessOptions({
      isContinuation,
      isIsolated: true,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
      context,
      communicationMode: config?.defaultCommunicationMode,
    })
  );

  logger.info(`Worker Agent [${agentId}] completed task:`, responseText);

  // 4. Notification
  if (!isTaskPaused(responseText)) {
    const isFailure = detectFailure(responseText);

    if (shouldSpeakDirectly && !isFailure) {
      await sendOutboundMessage(
        `${agentId}.agent`,
        baseUserId,
        responseText,
        [baseUserId],
        sessionId,
        config?.name,
        resultAttachments
      );
    }

    await emitTaskEvent({
      source: `${agentId}.agent`,
      agentId,
      userId: baseUserId,
      task,
      [isFailure ? 'error' : 'response']: responseText,
      attachments: resultAttachments,
      traceId,
      sessionId,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      userNotified: shouldSpeakDirectly && !isFailure,
    });
  }

  return responseText;
}
