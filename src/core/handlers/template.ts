import { DynamoMemory } from '../lib/memory.js';
import { Agent } from '../lib/agent.js';
import { ProviderManager } from '../lib/providers/index.js';
import { tools } from '../tools/index.js';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const agent = new Agent(
  memory,
  provider,
  Object.values(tools),
  ` You are the <NAME> Agent.
    Your mission: <MISSION>
    
    RULES:
    1. <RULE_1>
    2. <RULE_2>`
);

export const handler = async (event: { userId: string; data: string }) => {
  console.log('<NAME> Agent received event:', JSON.stringify(event, null, 2));

  // Extract necessary data from event
  const { userId, data } = event;

  // Process task
  const response = await agent.process(userId, `TASK: ${data}`);

  return response;
};
