import { emitEvent } from './utils/bus';
import { EventType, Attachment } from './types/index';

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
  messageId?: string
): Promise<void> {
  await emitEvent(source, EventType.OUTBOUND_MESSAGE, {
    userId,
    message,
    memoryContexts,
    sessionId,
    agentName,
    attachments,
    messageId,
  });
}
