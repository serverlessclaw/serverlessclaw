import { Resource } from 'sst';
import { DynamoMemory } from '../lib/memory';
import { MessageRole } from '../lib/types/llm';
import { Attachment } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { extractBaseUserId } from '../lib/utils/agent-helpers';

const memory = new DynamoMemory();

interface NotifierEvent {
  detail: {
    userId: string;
    message: string;
    memoryContexts?: string[];
    sessionId?: string;
    agentName?: string;
    attachments?: Attachment[];
    options?: {
      label: string;
      value: string;
      type?: 'primary' | 'secondary' | 'danger';
    }[];
  };
}

/**
 * Handles outbound messages by syncing context with memory and sending via Telegram.
 *
 * @param event - The Notifier event containing userId, message, and memoryContexts.
 * @returns A promise that resolves when the notification has been processed.
 */
export const handler = async (event: NotifierEvent): Promise<void> => {
  logger.info('[NOTIFIER] Received event:', JSON.stringify(event, null, 2));

  // The event is wrapped by EventBridge, the actual payload is in event.detail
  const payload = event.detail;
  if (!payload || !payload.userId || !payload.message) {
    logger.error('[NOTIFIER] Missing userId or message in OUTBOUND_MESSAGE event');
    return;
  }

  const { userId, message, memoryContexts, sessionId, agentName, attachments, options } = payload;

  // Defensive Normalization: Ensure we have the base user ID for syncing and Telegram
  const baseUserId = extractBaseUserId(userId);
  logger.info(
    `[NOTIFIER] Normalized User: ${baseUserId} | Session: ${sessionId} | Contexts: ${memoryContexts?.length ?? 0}`
  );

  const contextsToSync = new Set<string>(memoryContexts ?? []);
  contextsToSync.add(baseUserId); // Always sync to the base user history
  if (sessionId) {
    contextsToSync.add(`CONV#${baseUserId}#${sessionId}`);
  }

  for (const contextId of contextsToSync) {
    // 1. Sync context
    try {
      await memory.addMessage(contextId, {
        role: MessageRole.ASSISTANT,
        content: message,
        agentName: agentName,
        attachments: attachments,
        options: options,
      });
    } catch (e) {
      logger.error(`Failed to sync context to ${contextId}:`, e);
    }
  }

  // 2. Telegram Adapter
  // Only send via Telegram if the baseUserId is a numeric chat ID.
  // Dashboard users (e.g., "dashboard-user") don't have Telegram chat IDs.
  const isTelegramChatId = /^\d+$/.test(baseUserId);
  if (!isTelegramChatId) {
    logger.info(`[NOTIFIER] Skipping Telegram for non-numeric userId: ${baseUserId}`);
    return;
  }

  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      if (attachment.url) {
        await sendTelegramMedia(baseUserId, attachment, message, options);
      } else {
        logger.warn('Skipping attachment without URL for Telegram:', attachment.name);
      }
    }
  } else {
    await sendTelegramMessage(baseUserId, message, options);
  }

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
async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: { label: string; value: string }[]
): Promise<void> {
  try {
    const token = (Resource as unknown as { TelegramBotToken: { value: string } }).TelegramBotToken
      .value;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: escapeHtml(text),
      parse_mode: 'HTML',
    };

    if (options && options.length > 0) {
      body.reply_markup = {
        inline_keyboard: [options.map((opt) => ({ text: opt.label, callback_data: opt.value }))],
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Telegram API error:', errorText);
    }
  } catch (e) {
    logger.error('Failed to send Telegram message:', e);
  }
}

/**
 * Sends media via the Telegram Bot API.
 */
async function sendTelegramMedia(
  chatId: string,
  attachment: Attachment,
  caption?: string,
  options?: { label: string; value: string }[]
): Promise<void> {
  try {
    const token = (Resource as unknown as { TelegramBotToken: { value: string } }).TelegramBotToken
      .value;

    let method = 'sendDocument';
    let bodyKey = 'document';

    if (attachment.type === 'image') {
      method = 'sendPhoto';
      bodyKey = 'photo';
    }

    const url = `https://api.telegram.org/bot${token}/${method}`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      [bodyKey]: attachment.url,
      caption: caption ? escapeHtml(caption) : undefined,
      parse_mode: 'HTML',
    };

    if (options && options.length > 0) {
      body.reply_markup = {
        inline_keyboard: [options.map((opt) => ({ text: opt.label, callback_data: opt.value }))],
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Telegram API error (${method}):`, errorText);
    }
  } catch (e) {
    logger.error('Failed to send Telegram media:', e);
  }
}

/**
 * Escapes special characters for Telegram HTML parse mode.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
