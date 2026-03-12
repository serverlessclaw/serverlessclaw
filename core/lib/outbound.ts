import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { SSTResource, EventType } from './types/index';
import { logger } from './logger';

const eventbridge = new EventBridgeClient({});
const typedResource = Resource as unknown as SSTResource;

/**
 * Sends an outbound message event to the system bus.
 *
 * @param source - The source of the message (e.g., 'webhook.handler').
 * @param userId - The ID of the user to receive the message.
 * @param message - The content of the message.
 * @param memoryContexts - Optional array of context IDs to sync the message to.
 * @param sessionId - Optional dashboard session ID for targeted delivery.
 * @param agentName - Optional name of the agent sending the message.
 * @returns A promise that resolves when the event has been sent.
 */
export async function sendOutboundMessage(
  source: string,
  userId: string,
  message: string,
  memoryContexts?: string[],
  sessionId?: string,
  agentName?: string
): Promise<void> {
  try {
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: source,
            DetailType: EventType.OUTBOUND_MESSAGE,
            Detail: JSON.stringify({ userId, message, memoryContexts, sessionId, agentName }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error(`Failed to send outbound message from ${source}:`, e);
  }
}
