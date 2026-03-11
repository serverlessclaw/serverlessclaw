import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { AgentRegistry } from '../lib/registry';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';

const memory = new DynamoMemory();
const provider = new ProviderManager();

interface WorkerEvent {
  'detail-type': string;
  detail: {
    userId: string;
    task: string;
  };
}

export const handler = async (event: WorkerEvent) => {
  logger.info('Worker Agent received event:', JSON.stringify(event, null, 2));

  // Extract agentId from the event source or detail-type
  // Pattern: <agentId>_task
  const detailType = event['detail-type'] || '';
  const agentId = detailType.replace('_task', '');

  if (!agentId) {
    logger.error('Could not determine agentId from event');
    return;
  }

  const { userId, task } = event.detail;

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
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt);

  // 3. Execution
  // Use model overwrite if provided in config
  if (config.model) {
    // We'd need to extend ProviderManager/Provider to support per-call model overrides
    // For now, we use the global active model
  }

  const response = await agent.process(userId, task);

  logger.info(`Worker Agent [${agentId}] completed task:`, response);

  // 4. Notification (Optional: Worker could be silent or chatty)
  await sendOutboundMessage(`worker.agent.${agentId}`, userId, response, [userId]);

  return response;
};
