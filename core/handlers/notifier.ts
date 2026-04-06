import { Resource } from 'sst';
import { DynamoMemory } from '../lib/memory';
import { MessageRole, AttachmentType, ButtonType } from '../lib/types/llm';
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
      type?: ButtonType;
    }[];
    /** Optional workspace ID for multi-human notification fan-out. */
    workspaceId?: string;
    /** Optional collaboration ID for multi-human notification fan-out. */
    collaborationId?: string;
  };
}

/**
 * Handles outbound messages by syncing context with memory and sending via configured channels.
 * Supports multi-platform fan-out (Telegram, Discord, Slack) via Workspaces.
 */
export const handler = async (event: NotifierEvent): Promise<void> => {
  logger.info('[NOTIFIER] Received event:', JSON.stringify(event, null, 2));

  const payload = event.detail;
  if (!payload || !payload.userId || !payload.message) {
    logger.error('[NOTIFIER] Missing userId or message in OUTBOUND_MESSAGE event');
    return;
  }

  const {
    userId,
    message,
    memoryContexts,
    sessionId,
    agentName,
    attachments,
    options,
    workspaceId,
    collaborationId,
  } = payload;

  const baseUserId = extractBaseUserId(userId);
  logger.info(
    `[NOTIFIER] Normalized User: ${baseUserId} | Session: ${sessionId} | Workspace: ${workspaceId ?? 'none'}`
  );

  // 1. Sync context to memory
  const contextsToSync = new Set<string>(memoryContexts ?? []);
  contextsToSync.add(baseUserId);
  if (sessionId) {
    contextsToSync.add(`CONV#${baseUserId}#${sessionId}`);
  }

  for (const contextId of contextsToSync) {
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

  // 2. Deliver to channels
  if (collaborationId) {
    await sendToCollaboration(collaborationId, message, attachments, options);
  } else if (workspaceId) {
    await sendToWorkspace(workspaceId, message, attachments, options);
  } else {
    // Legacy single-user path (defaults to Telegram)
    await sendToSingleUser(baseUserId, message, attachments, options);
  }
};

/**
 * Fans out a notification to all human participants of a collaboration.
 */
async function sendToCollaboration(
  collaborationId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const { getCollaboration } = await import('../lib/memory/collaboration-operations');
  const { getWorkspace, getHumanMembersWithChannels } =
    await import('../lib/memory/workspace-operations');

  const collaboration = await getCollaboration(memory, collaborationId);
  if (!collaboration) {
    logger.warn(`[NOTIFIER] Collaboration not found: ${collaborationId}`);
    return;
  }

  const deliveryPromises: Promise<void>[] = [];

  // 1. Get human participants explicitly listed in collaboration
  const humanParticipants = collaboration.participants.filter((p) => p.type === 'human');

  // 2. If collaboration is in a workspace, get channels from workspace metadata
  if (collaboration.workspaceId) {
    const workspace = await getWorkspace(collaboration.workspaceId);
    if (workspace) {
      const humanMembers = getHumanMembersWithChannels(workspace);
      for (const hp of humanParticipants) {
        const member = humanMembers.find((m) => m.memberId === hp.id);
        if (member) {
          for (const channel of member.channels) {
            if (!channel.enabled) continue;
            deliveryPromises.push(
              sendToChannel(channel.platform, channel.identifier, message, attachments, options)
            );
          }
        }
      }
    }
  } else {
    // 3. Fallback: If not in workspace, we assume human ID is a Telegram ID (legacy/simple)
    for (const hp of humanParticipants) {
      const isTelegramChatId = /^\d+$/.test(hp.id);
      if (isTelegramChatId) {
        deliveryPromises.push(sendToChannel('telegram', hp.id, message, attachments, options));
      }
    }
  }

  await Promise.all(deliveryPromises);
}

/**
 * Fans out a notification to all human members of a workspace.
 */
async function sendToWorkspace(
  workspaceId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const { getWorkspace, getHumanMembersWithChannels } =
    await import('../lib/memory/workspace-operations');
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    logger.warn(`[NOTIFIER] Workspace not found: ${workspaceId}`);
    return;
  }

  const humans = getHumanMembersWithChannels(workspace);
  const deliveryPromises: Promise<void>[] = [];

  for (const human of humans) {
    for (const channel of human.channels) {
      if (!channel.enabled) continue;
      deliveryPromises.push(
        sendToChannel(channel.platform, channel.identifier, message, attachments, options)
      );
    }
  }

  await Promise.allSettled(deliveryPromises);
}

/**
 * Sends to a single user via Telegram (legacy path).
 */
async function sendToSingleUser(
  baseUserId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const isTelegramChatId = /^\d+$/.test(baseUserId);
  if (!isTelegramChatId) return;

  await sendToChannel('telegram', baseUserId, message, attachments, options);
}

/**
 * Routes a message to a specific platform channel.
 */
async function sendToChannel(
  platform: string,
  identifier: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  switch (platform.toLowerCase()) {
    case 'telegram':
      await deliverTelegram(identifier, message, attachments, options);
      break;
    case 'discord':
      await deliverDiscord(identifier, message, attachments, options);
      break;
    case 'slack':
      await deliverSlack(identifier, message, attachments, options);
      break;
    default:
      logger.warn(`[NOTIFIER] Unsupported platform: ${platform}`);
  }
}

/**
 * Validates the fetch response and throws on specific retryable or fatal errors.
 * 429 (Rate Limit) and 401 (Auth Failure) should trigger retries or visibility.
 */
async function validateResponse(response: Response, platform: string): Promise<void> {
  if (!response.ok) {
    const status = response.status;
    const body = await response.text().catch(() => 'No body');
    const errorMsg = `[NOTIFIER] ${platform} API error (${status}): ${body}`;

    if (status === 429 || status === 401 || status >= 500) {
      throw new Error(errorMsg);
    } else {
      logger.error(errorMsg);
    }
  }
}

/**
 * Telegram Adapter
 */
async function deliverTelegram(
  chatId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const token = (Resource as unknown as Record<string, { value?: string }>).TelegramBotToken?.value;
  if (!token) throw new Error('TelegramBotToken not configured');

  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      if (!attachment.url) continue;
      const method = attachment.type === AttachmentType.IMAGE ? 'sendPhoto' : 'sendDocument';
      const bodyKey = attachment.type === AttachmentType.IMAGE ? 'photo' : 'document';

      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          [bodyKey]: attachment.url,
          caption: escapeHtml(message),
          parse_mode: 'HTML',
          reply_markup: options?.length
            ? {
                inline_keyboard: [options.map((o) => ({ text: o.label, callback_data: o.value }))],
              }
            : undefined,
        }),
        signal: AbortSignal.timeout(10000),
      });
      await validateResponse(response, 'Telegram');
    }
  } else {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: escapeHtml(message),
        parse_mode: 'HTML',
        reply_markup: options?.length
          ? {
              inline_keyboard: [options.map((o) => ({ text: o.label, callback_data: o.value }))],
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(10000),
    });
    await validateResponse(response, 'Telegram');
  }
}

/**
 * Discord Adapter (Bot API)
 */
async function deliverDiscord(
  channelId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const token = (Resource as unknown as Record<string, { value?: string }>).DiscordBotToken?.value;
  if (!token) throw new Error('DiscordBotToken not configured');

  const embeds = attachments
    ?.filter((a) => a.url)
    .map((a) => ({
      image: a.type === AttachmentType.IMAGE ? { url: a.url } : undefined,
      url: a.type !== AttachmentType.IMAGE ? a.url : undefined,
      title: a.name || (a.type !== AttachmentType.IMAGE ? 'Attachment' : undefined),
    }));

  // Discord components for buttons
  const components = options?.length
    ? [
        {
          type: 1, // Action Row
          components: options.map((o) => ({
            type: 2,
            style: 1,
            label: o.label,
            custom_id: o.value,
          })),
        },
      ]
    : undefined;

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: message,
      embeds: embeds?.length ? embeds : undefined,
      components,
    }),
    signal: AbortSignal.timeout(10000),
  });
  await validateResponse(response, 'Discord');
}

/**
 * Slack Adapter
 */
async function deliverSlack(
  channelId: string,
  message: string,
  attachments?: Attachment[],
  options?: { label: string; value: string }[]
): Promise<void> {
  const token = (Resource as unknown as Record<string, { value?: string }>).SlackBotToken?.value;
  if (!token) throw new Error('SlackBotToken not configured');

  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message },
    },
  ];

  if (attachments?.length) {
    for (const a of attachments) {
      if (a.type === AttachmentType.IMAGE && a.url) {
        blocks.push({
          type: 'image',
          image_url: a.url,
          alt_text: a.name || 'image',
        });
      } else if (a.url) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*Attachment:* <${a.url}|${a.name || 'Link'}>` },
        });
      }
    }
  }

  if (options?.length) {
    blocks.push({
      type: 'actions',
      elements: options.map(
        (o): Record<string, unknown> => ({
          type: 'button',
          text: { type: 'plain_text', text: o.label },
          value: o.value,
          action_id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        })
      ),
    });
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: channelId,
      blocks,
    }),
    signal: AbortSignal.timeout(10000),
  });
  await validateResponse(response, 'Slack');
}

/**
 * Escapes special characters for Telegram HTML parse mode.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
