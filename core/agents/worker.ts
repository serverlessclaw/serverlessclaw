import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { EventType, TraceSource, TaskEvent, SSTResource } from '../lib/types/index';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
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

const eventbridge = new EventBridgeClient({});
const typedResource = Resource as unknown as SSTResource;

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
export const handler = async (
  event: WorkerEvent,
  context: Context
): Promise<string | undefined> => {
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

  // 1. Discovery: Load dynamic config
  const config = await loadAgentConfig(agentId);

  // 2. Initialization: Setup tools and prompt
  const { memory, provider } = getAgentContext();
  const agent = await createAgent(agentId, config, memory, provider);

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
    })
  );

  logger.info(`Worker Agent [${agentId}] completed task:`, responseText);

  // 4. Notification (Optional: Worker could be silent or chatty)
  if (!isTaskPaused(responseText)) {
    const isFailure = detectFailure(responseText);
    try {
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: `${agentId}.agent`,
              DetailType: isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED,
              Detail: JSON.stringify({
                userId,
                agentId,
                task,
                [isFailure ? 'error' : 'response']: responseText,
                attachments: resultAttachments,
                traceId,
                sessionId,
                initiatorId: payload.initiatorId,
                depth: payload.depth,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    } catch (e) {
      logger.error(`Failed to emit ${isFailure ? 'TASK_FAILED' : 'TASK_COMPLETED'}:`, e);
    }
  }

  return responseText;
};
