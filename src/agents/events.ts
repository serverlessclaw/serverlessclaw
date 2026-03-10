import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers';
import { tools } from '../tools/index';
import { Resource } from 'sst';
import { EventType } from '../lib/types';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const agent = new Agent(memory, provider, Object.values(tools));
const eventbridge = new EventBridgeClient({});

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
    const responseText = await agent.process(userId, `SYSTEM_NOTIFICATION: ${task}`);

    // Notify user via Notifier
    await sendOutboundMessage(userId, responseText);
  }
};

async function sendOutboundMessage(userId: string, message: string) {
  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'events.handler',
          DetailType: EventType.OUTBOUND_MESSAGE,
          Detail: JSON.stringify({ userId, message }),
          EventBusName: (Resource as any).AgentBus.name,
        },
      ],
    })
  );
}
