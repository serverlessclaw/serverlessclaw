import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers';
import { getAgentTools } from '../tools/index';
import { EventType } from '../lib/types';
import { sendOutboundMessage } from '../lib/outbound';

const memory = new DynamoMemory();
const provider = new ProviderManager();

export const handler = async (event: {
  'detail-type': string;
  detail: Record<string, unknown>;
}) => {
  console.log('EventHandler received event:', JSON.stringify(event, null, 2));

  const { userId, buildId, errorLogs } = event.detail as {
    userId: string;
    buildId?: string;
    errorLogs?: string;
  };

  if (event['detail-type'] === EventType.SYSTEM_BUILD_FAILED) {
    const task = `CRITICAL: Deployment ${buildId} failed. 
    Here are the last few lines of the logs:
    ---
    ${errorLogs}
    ---
    Please investigate the codebase, find the root cause, fix the issue, and trigger a new deployment. 
    Explain your plan to the user before proceeding.`;

    // Process the failure context via the Main Agent
    const agentTools = await getAgentTools('events');
    const agent = new Agent(memory, provider, agentTools);
    const responseText = await agent.process(userId, `SYSTEM_NOTIFICATION: ${task}`);

    // Notify user via Notifier
    await sendOutboundMessage('events.handler', userId, responseText);
  }
};
