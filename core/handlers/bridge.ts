import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { Context } from 'aws-lambda';
import { BridgeEventSchema } from '../lib/schema/events';

const iot = new IoTDataPlaneClient({});

/**
 * Bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 * This allows the dashboard to receive background updates in real-time.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 */
export const handler = async (event: Record<string, unknown>, _context: Context) => {
  const parsedEventResult = BridgeEventSchema.safeParse(event);
  if (!parsedEventResult.success) {
    console.error('[RealtimeBridge] Invalid bridge event payload:', parsedEventResult.error);
    return;
  }

  const parsedEvent = parsedEventResult.data;
  console.log('[RealtimeBridge] Received event:', parsedEvent['detail-type']);

  const { detail } = parsedEvent;
  // Standardize userId: fallback to dashboard-user, then ensure it's a clean string
  let userId = detail.userId ?? 'dashboard-user';
  if (typeof userId !== 'string') userId = 'dashboard-user';

  // Clean userId for MQTT topic (no special chars except allowed ones)
  const safeUserId = userId.replace(/[#+]/g, '_');
  const sessionId = detail.sessionId;

  // If we have a sessionId, we can target the specific chat session
  // Otherwise fallback to the generic user signal topic
  const topic = sessionId
    ? `users/${safeUserId}/sessions/${sessionId}/signal`
    : `users/${safeUserId}/signal`;

  try {
    console.log(`[RealtimeBridge] Publishing to: ${topic}`);
    // AWS IoT requires payload to be a Uint8Array or string
    const command = new PublishCommand({
      topic,
      payload: Buffer.from(JSON.stringify(detail)),
      qos: 1,
    });

    await iot.send(command);
    console.log(`[RealtimeBridge] Successfully published to ${topic}`);
  } catch (error) {
    console.error(`[RealtimeBridge] Failed to publish to ${topic}:`, error);
  }
};
