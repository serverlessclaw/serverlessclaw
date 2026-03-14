import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { logger } from '../lib/logger';
import { AgentType } from '../lib/types/index';

const memory = new DynamoMemory();
const provider = new ProviderManager();

export const handler = async (event: { userId: string; data: string }) => {
  logger.info('<NAME> Agent received event:', JSON.stringify(event, null, 2));

  // Extract necessary data from event
  const { userId, data } = event;

  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(AgentType.MAIN); // Replace with actual type
  if (!config) throw new Error('Config load failed');

  const agentTools = await getAgentTools('main'); // Replace with actual name
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  // Process task
  const { responseText } = await agent.process(userId, `TASK: ${data}`);

  return responseText;
};
