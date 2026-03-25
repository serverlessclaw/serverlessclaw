import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { Context } from 'aws-lambda';
import { BRIDGE_EVENT_SCHEMA } from '../lib/schema/events';
import { extractBaseUserId } from '../lib/utils/agent-helpers';

const iot = new IoTDataPlaneClient({});

/**
 * Bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 * This allows the dashboard to receive background updates in real-time.
 *
 * @param event - The EventBridge event.
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

  // Standardize userId: fallback to dashboard-user, then ensure it's a clean string
  let userId = detail.userId ?? 'dashboard-user';
  if (typeof userId !== 'string') userId = 'dashboard-user';

  // Normalize userId to base form for MQTT topic consistency
  const baseUserId = extractBaseUserId(userId);

  // Clean userId for MQTT topic (no special chars except allowed ones)
  const safeUserId = baseUserId.replace(/[#+]/g, '_');
  const sessionId = detail.sessionId;

  // Extract more context for focused logging
  const messageId = detail.messageId || detail.traceId || 'unknown';
  const agentName = detail.agentName || 'SuperClaw';
  const rawMessage = (detail.message || '') as string;
  const contentSnippet =
    rawMessage.length > 50
      ? rawMessage.substring(0, 50).replace(/\n/g, ' ') + '...'
      : rawMessage.replace(/\n/g, ' ');

  console.log(
    `[RealtimeBridge] Routing ${eventType}: User=${userId} | Session=${sessionId} | MsgId=${messageId} | Agent=${agentName}`
  );
  if (rawMessage) {
    console.log(
      `[RealtimeBridge] Content: "${contentSnippet}"${detail.isThought ? ' (thought)' : ''}`
    );
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
