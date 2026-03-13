import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { AgentRegistry } from '../lib/registry';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { EventType, TraceSource, TaskEvent, SSTResource } from '../lib/types/index';

const memory = new DynamoMemory();
const provider = new ProviderManager();
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
  const { userId, task, isContinuation, traceId, sessionId } = event.detail;

  if (!userId || !task) {
    logger.error('Invalid event payload: missing userId or task');
    return;
  }

  // 1. Discovery: Load dynamic config
  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config) {
    logger.error(`Agent configuration for '${agentId}' not found in Registry.`);
    return;
  }

  if (!config.enabled) {
    logger.warn(`Agent '${agentId}' is disabled. Skipping task.`);
    return;
  }

  // 2. Initialization: Setup tools and prompt
  const agentTools = await getAgentTools(agentId);
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  // 3. Execution
  const response = await agent.process(userId, task, {
    context,
    isContinuation: !!isContinuation,
    isIsolated: true,
    initiatorId: event.detail.initiatorId,
    depth: event.detail.depth,
    traceId: traceId,
    sessionId,
    source: TraceSource.SYSTEM,
  });

  logger.info(`Worker Agent [${agentId}] completed task:`, response);

  // 4. Notification (Optional: Worker could be silent or chatty)
  if (!response.startsWith('TASK_PAUSED')) {
    const isFailure = response.startsWith('I encountered an internal error');
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
                [isFailure ? 'error' : 'response']: response,
                traceId,
                sessionId,
                initiatorId: event.detail.initiatorId,
                depth: event.detail.depth,
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

  return response;
};
