import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { SSTResource, EventType } from '../types/index';
import { logger } from '../logger';

const eventbridge = new EventBridgeClient({});
const typedResource = Resource as unknown as SSTResource;

/**
 * Shared utility for emitting events to the system AgentBus.
 *
 * @param source - The source identifier for the event (e.g., 'heartbeat.scheduler').
 * @param type - The event type (e.g., EventType.HEARTBEAT_PROACTIVE).
 * @param detail - The event detail payload as a record of key-value pairs.
 */
export async function emitEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>
): Promise<void> {
  const busName = typedResource.AgentBus?.name ?? 'AgentBus';

  try {
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: source,
          DetailType: type,
          Detail: JSON.stringify(detail),
          EventBusName: busName,
        },
      ],
    });
    await eventbridge.send(command);
    logger.info(`Event emitted from ${source}: ${type}`);
  } catch (error) {
    logger.error(`Failed to emit event from ${source}:`, error);
    throw error;
  }
}
