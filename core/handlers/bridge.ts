import { Resource } from 'sst';

/**
 * Bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 * This allows the dashboard to receive background updates in real-time.
 */
export const handler = async (event: any) => {
  console.log('[RealtimeBridge] Received event:', event['detail-type']);

  const userId = event.detail.userId || 'dashboard-user';
  const sessionId = event.detail.sessionId;

  // If we have a sessionId, we can target the specific chat session
  // Otherwise fallback to the generic user signal topic
  const topic = sessionId
    ? `users/${userId}/sessions/${sessionId}/signal`
    : `users/${userId}/signal`;

  try {
    // SST v3+ uses Resource.<Name>.publish for Realtime resources
    await (Resource as any).RealtimeBus.publish({
      topic,
      payload: event.detail,
    });
    console.log(`[RealtimeBridge] Published to ${topic}`);
  } catch (error) {
    console.error('[RealtimeBridge] Failed to publish:', error);
  }
};
