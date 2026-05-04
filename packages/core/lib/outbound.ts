import { emitEvent, EventPriority } from './utils/bus';
import { EventType } from './types/agent';
import { Attachment } from './types/llm';
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
 * @param options - Optional array of interactive button options for the message.
 * @param workspaceId - Optional workspace identifier for isolation and routing.
 * @param collaborationId - Optional collaboration ID for multi-agent collaboration sessions.
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
  }[],
  workspaceId?: string,
  teamId?: string,
  staffId?: string,
  collaborationId?: string
): Promise<void> {
  // Normalize userId to base form for memory syncing and event routing
  const baseUserId = extractBaseUserId(userId);

  await emitEvent(
    source,
    EventType.OUTBOUND_MESSAGE,
    {
      userId: baseUserId, // Send clean, base userId to avoid leaking DynamoDB prefixes (CONV#)
      message,
      memoryContexts: memoryContexts ?? [baseUserId],
      sessionId,
      workspaceId,
      teamId,
      staffId,
      agentName,
      attachments,
      messageId,
      options,
      collaborationId,
    },
    { priority: EventPriority.HIGH }
  );
}
