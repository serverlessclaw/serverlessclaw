import { emitEvent, EventPriority } from './utils/bus';
import { EventType, Attachment } from './types/agent';
import { extractBaseUserId } from './utils/agent-helpers';

/**
 * Sends an outbound message event to the system bus.
 *
 * @param source - The source of the message (e.g., 'webhook.handler').
 * @param userId - The ID of the user to receive the message.
 * @param message - The content of the message.
 * @param memoryContexts - Optional array of context IDs to sync the message to.
 * @param sessionId - Optional dashboard session ID for targeted delivery.
 * @param agentName - Optional name of the agent sending the message.
 * @param attachments - Optional attachments to include in the message.
 * @param messageId - Optional ID for the message to track it throughout the system.
 * @returns A promise that resolves when the event has been sent.
 */
export async function sendOutboundMessage(
  source: string,
  userId: string,
  message: string,
  memoryContexts?: string[],
  sessionId?: string,
  agentName?: string,
  attachments?: Attachment[],
  messageId?: string,
  options?: {
    label: string;
    value: string;
    type?: 'primary' | 'secondary' | 'danger';
  }[]
): Promise<void> {
  // Normalize userId to base form for memory syncing, but keep original for routing
  const baseUserId = extractBaseUserId(userId);

  await emitEvent(
    source,
    EventType.OUTBOUND_MESSAGE,
    {
      userId: userId, // Use original ID (e.g. CONV#...) for bridge routing
      message,
      memoryContexts: memoryContexts ?? [baseUserId],
      sessionId,
      agentName,
      attachments,
      messageId,
      options,
    },
    { priority: EventPriority.HIGH }
  );
}
