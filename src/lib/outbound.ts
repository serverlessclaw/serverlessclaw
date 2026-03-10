import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { EventType } from './types';

const eventbridge = new EventBridgeClient({});

export async function sendOutboundMessage(
  source: string,
  userId: string,
  message: string,
  memoryContexts?: string[]
) {
  try {
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: source,
            DetailType: EventType.OUTBOUND_MESSAGE,
            Detail: JSON.stringify({ userId, message, memoryContexts }),
            EventBusName: (Resource as any).AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    console.error(`Failed to send outbound message from ${source}:`, e);
  }
}
