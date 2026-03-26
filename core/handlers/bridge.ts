import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { Context } from 'aws-lambda';
import { BRIDGE_EVENT_SCHEMA } from '../lib/schema/events';

const iot = new IoTDataPlaneClient({});

/**
 * Bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 * Provides a real-time signal link for the dashboard to receive background updates.
 *
 * @param event - The EventBridge event containing the agent signal detail.
 * @param _context - The AWS Lambda context (unused).
 */
export async function handler(event: Record<string, unknown>, _context: Context): Promise<void> {
  const parsedEventResult = BRIDGE_EVENT_SCHEMA.safeParse(event);
  if (!parsedEventResult.success) {
    console.error('[RealtimeBridge] Invalid bridge event payload:', parsedEventResult.error);
    return;
  }

  const parsedEvent = parsedEventResult.data;
  console.log('[RealtimeBridge] Received event:', parsedEvent['detail-type']);

  const { detail } = parsedEvent;
  const eventType = parsedEvent['detail-type'];

  // All properties are now resolved by BRIDGE_DETAIL_PAYLOAD_SCHEMA at the source
  const {
    userId,
    baseUserId,
    sessionId,
    messageId,
    agentName,
    message: rawMessage,
    isThought,
  } = detail;

  const safeUserId = baseUserId.replace(/[#+]/g, '_');

  const contentSnippet =
    rawMessage.length > 50
      ? rawMessage.substring(0, 50).replace(/\n/g, ' ') + '...'
      : rawMessage.replace(/\n/g, ' ');

  console.log(
    `[RealtimeBridge] Routing ${eventType}: User=${userId} | Session=${sessionId} | MsgId=${messageId} | Agent=${agentName}`
  );
  if (rawMessage) {
    console.log(`[RealtimeBridge] Content: "${contentSnippet}"${isThought ? ' (thought)' : ''}`);
  }

  // If we have a sessionId, we can target the specific chat session
  // Otherwise fallback to the generic user signal topic
  const topic = sessionId
    ? `users/${safeUserId}/sessions/${sessionId}/signal`
    : `users/${safeUserId}/signal`;

  try {
    // AWS IoT requires payload to be a Uint8Array or string
    const command = new PublishCommand({
      topic,
      payload: Buffer.from(
        JSON.stringify({
          ...detail,
          'detail-type': eventType,
        })
      ),
      qos: 1,
    });

    await iot.send(command);
    console.log(`[RealtimeBridge] Successfully published to ${topic}`);
  } catch (error) {
    console.error(`[RealtimeBridge] Failed to publish to ${topic}:`, error);
  }
}
