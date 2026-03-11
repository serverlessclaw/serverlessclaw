import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { EventType } from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { MANAGER_SYSTEM_PROMPT } from '../agents/manager';
import { logger } from '../lib/logger';

const memory = new DynamoMemory();
const provider = new ProviderManager();

export const handler = async (event: {
  'detail-type': string;
  detail: Record<string, unknown>;
}) => {
  logger.info('EventHandler received event:', JSON.stringify(event, null, 2));

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
    const agent = new Agent(memory, provider, agentTools, MANAGER_SYSTEM_PROMPT);
    const responseText = await agent.process(userId, `SYSTEM_NOTIFICATION: ${task}`);

    // Notify user via Notifier
    await sendOutboundMessage('events.handler', userId, responseText);
  } else if (event['detail-type'] === EventType.SYSTEM_BUILD_SUCCESS) {
    const message = `✅ **DEPLOYMENT SUCCESSFUL**
Build ID: ${buildId}

The system has successfully evolved and all planned gaps have been marked as DONE. 
I am ready for further tasks or instructions.`;

    await sendOutboundMessage('events.handler', userId, message);
  }
};
