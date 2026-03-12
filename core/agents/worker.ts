import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { AgentRegistry } from '../lib/registry';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { EventType } from '../lib/types/index';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const eventbridge = new EventBridgeClient({});

interface WorkerEvent {
  'detail-type': string;
  detail: {
    userId: string;
    task: string;
    isContinuation?: boolean;
    traceId?: string;
  };
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
  const agentId = detailType.replace('_task', '');

  if (!agentId) {
    logger.error('Could not determine agentId from event');
    return;
  }

  const { userId, task, isContinuation, traceId } = event.detail;

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
    initiatorId: (event.detail as any).initiatorId,
    depth: (event.detail as any).depth,
  });

  logger.info(`Worker Agent [${agentId}] completed task:`, response);

  // 4. Notification (Optional: Worker could be silent or chatty)
  // Only send if not paused (Agent returns a specific string if paused)
  if (!response.startsWith('TASK_PAUSED')) {
    await sendOutboundMessage(`worker.agent.${agentId}`, userId, response, [userId]);

    // Emit Task Completion for Orchestrator Resumption
    try {
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: `worker.agent.${agentId}`,
              DetailType: EventType.TASK_COMPLETED,
              Detail: JSON.stringify({
                userId,
                agentId,
                task,
                response,
                traceId,
                initiatorId: (event.detail as any).initiatorId,
                depth: (event.detail as any).depth,
              }),
              EventBusName: (Resource as any).AgentBus.name,
            },
          ],
        })
      );
    } catch (e) {
      logger.error('Failed to emit TASK_COMPLETED:', e);
    }
  }

  return response;
};
