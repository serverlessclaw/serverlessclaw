import { Resource } from 'sst';
import { DynamoMemory } from '../lib/memory';
import { MessageRole } from '../lib/types/index';
import { logger } from '../lib/logger';

const memory = new DynamoMemory();

interface NotifierEvent {
  detail: {
    userId: string;
    message: string;
    memoryContexts?: string[];
    sessionId?: string;
    agentName?: string;
  };
}

/**
 * Handles outbound messages by syncing context with memory and sending via Telegram.
 *
 * @param event - The Notifier event containing userId, message, and memoryContexts.
 * @returns A promise that resolves when the notification has been processed.
 */
export const handler = async (event: NotifierEvent): Promise<void> => {
  logger.info('NotifierAgent received event:', JSON.stringify(event, null, 2));

  // The event is wrapped by EventBridge, the actual payload is in event.detail
  const payload = event.detail;
  if (!payload || !payload.userId || !payload.message) {
    logger.error('Missing userId or message in OUTBOUND_MESSAGE event');
    return;
  }

  const { userId, message, memoryContexts, sessionId, agentName } = payload;

  const contextsToSync = new Set<string>(memoryContexts || []);
  if (sessionId) {
    contextsToSync.add(`CONV#${userId}#${sessionId}`);
  }

  for (const contextId of contextsToSync) {
    // 1. Sync context
    try {
      await memory.addMessage(contextId, {
        role: MessageRole.ASSISTANT,
        content: message,
        agentName: agentName,
      });
    } catch (e) {
      logger.error(`Failed to sync context to ${contextId}:`, e);
    }
  }

  // 2. Telegram Adapter
  await sendTelegramMessage(userId, message);

  // Future Adapters (Slack, Discord, Dashboard WebSockets) can be added here
  // based on ConfigTable preferences
};

/**
 * Sends a message via the Telegram Bot API.
 *
 * @param chatId - The Telegram chat ID to send the message to.
 * @param text - The text of the message to send.
 * @returns A promise that resolves when the message has been sent.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  try {
    const token = (Resource as unknown as { TelegramBotToken: { value: string } }).TelegramBotToken
      .value;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Telegram API error:', errorText);
    }
  } catch (e) {
    logger.error('Failed to send Telegram message:', e);
  }
}
