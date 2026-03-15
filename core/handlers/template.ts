/**
 * NAME Agent handler - processes tasks using the NAME agent.
 * Uses lazy loading to minimize initial context budget.
 */
export const handler = async (event: { userId: string; data: string }) => {
  const { logger } = await import('../lib/logger');
  logger.info('NAME Agent received event:', JSON.stringify(event, null, 2));

  // Extract necessary data from event
  const { userId, data } = event;

  // Lazy load dependencies to reduce context budget
  const [
    { DynamoMemory },
    { Agent },
    { ProviderManager },
    { getAgentTools },
    { AgentRegistry },
    { AgentType },
  ] = await Promise.all([
    import('../lib/memory'),
    import('../lib/agent'),
    import('../lib/providers/index'),
    import('../tools/index'),
    import('../lib/registry'),
    import('../lib/types/index'),
  ]);

  const memory = new DynamoMemory();
  const provider = new ProviderManager();

  const config = await AgentRegistry.getAgentConfig(AgentType.MAIN);
  if (!config) throw new Error('Config load failed');

  const agentTools = await getAgentTools('main');
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  // Process task
  const { responseText } = await agent.process(userId, `TASK: ${data}`);

  return responseText;
};
