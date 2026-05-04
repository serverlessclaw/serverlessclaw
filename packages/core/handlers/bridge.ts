import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { Resource } from 'sst';
import { Context } from 'aws-lambda';
import { BRIDGE_EVENT_SCHEMA } from '../lib/schema/events';
import { logger } from '../lib/logger';

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
    logger.error('[RealtimeBridge] Invalid bridge event payload:', parsedEventResult.error);
    return;
  }

  const parsedEvent = parsedEventResult.data;
  logger.info('[RealtimeBridge] Received event:', parsedEvent['detail-type']);

  const { detail } = parsedEvent;
  const eventType = parsedEvent['detail-type'];

  // All properties are now resolved by BRIDGE_DETAIL_PAYLOAD_SCHEMA at the source
  const {
    userId,
    baseUserId,
    sessionId,
    message: rawMessage,
    isThought,
    workspaceId,
    teamId,
    staffId,
    collaborationId,
  } = detail;

  const { sanitizeMqttTopic } = await import('../lib/utils/normalize');
  const safeUserId = sanitizeMqttTopic(baseUserId);

  const contentSnippet =
    rawMessage.length > 50
      ? rawMessage.substring(0, 50).replace(/\n/g, ' ') + '...'
      : rawMessage.replace(/\n/g, ' ');

  logger.info(
    `[RealtimeBridge] Routing ${eventType}: User=${userId} | Session=${sessionId} | Collab=${collaborationId} | WS=${workspaceId} | TEAM=${teamId} | STAFF=${staffId}`
  );
  if (rawMessage) {
    logger.debug(`[RealtimeBridge] Content: "${contentSnippet}"${isThought ? ' (thought)' : ''}`);
  }

  // Determine the primary broadcast topic
  // Priority: Collaboration > Workspace > Session > User
  const prefix = `${Resource.App.name}/${Resource.App.stage}/`;
  let subTopic = `users/${safeUserId}/signal`;

  if (collaborationId) {
    subTopic = `collaborations/${sanitizeMqttTopic(collaborationId)}/signal`;
  } else if (teamId) {
    subTopic = `teams/${sanitizeMqttTopic(teamId)}/signal`;
  } else if (workspaceId) {
    subTopic = `workspaces/${sanitizeMqttTopic(workspaceId)}/signal`;
  } else if (sessionId) {
    subTopic = `users/${safeUserId}/sessions/${sessionId}/signal`;
  }

  // Handle Global System Metrics (D5)
  if (
    eventType === 'system_health_report' ||
    eventType === 'health_alert' ||
    eventType === 'metric_update'
  ) {
    subTopic = 'system/metrics';
  }

  const topic = `${prefix}${subTopic}`;

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
    logger.info(`[RealtimeBridge] Successfully published to ${topic}`);
  } catch (error) {
    logger.error(`[RealtimeBridge] Failed to publish to ${topic}:`, error);
    throw error;
  }
}
