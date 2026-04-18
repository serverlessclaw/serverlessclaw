import { ChatMessage, HistoryMessage } from './types';

/**
 * Data shape for an incoming MQTT chunk message.
 */
export interface IncomingChunk {
  sessionId?: string;
  messageId?: string;
  message?: string;
  userId?: string;
  isThought?: boolean;
  thought?: string;
  agentName?: string;
  attachments?: ChatMessage['attachments'];
  options?: ChatMessage['options'];
  toolCalls?: ChatMessage['tool_calls'];
  tool_calls?: ChatMessage['tool_calls'];
  ui_blocks?: ChatMessage['ui_blocks'];
  pageContext?: ChatMessage['pageContext'];
}

/**
 * Determines if an incoming MQTT chunk should be processed based on session routing.
 *
 * @param data - The incoming chunk data with optional detail-type.
 * @param currentActiveId - The currently active session ID.
 * @param expectedUserId - The expected user ID for this client.
 */
export function shouldProcessChunk(
  data: IncomingChunk & { 'detail-type'?: string; type?: string },
  currentActiveId: string,
  expectedUserId: string
): boolean {
  // Normalize incoming userId (remove CONV# prefix if present)
  const incomingUserId = data.userId?.startsWith('CONV#') ? data.userId.split('#')[1] : data.userId;

  // The dashboard client cannot read the HTTP-only session cookie user ID, so
  // treat the default sentinel as wildcard and rely on session/type matching.
  const useStrictUserFilter = expectedUserId !== 'dashboard-user';

  if (useStrictUserFilter && incomingUserId !== expectedUserId) {
    return false;
  }

  const type = data.type || data['detail-type'];
  if (type !== 'chunk' && type !== 'TEXT_MESSAGE_CONTENT') {
    return false;
  }

  // Stable message IDs are required to merge chunk updates into one bubble
  // and avoid echo/duplicate rendering from unrelated realtime events.
  if (!data.messageId) {
    return false;
  }

  // If no session ID in chunk, it's a global signal for the user
  if (!data.sessionId) {
    return true;
  }

  // Otherwise it MUST match the current active session
  const match = data.sessionId === currentActiveId;
  return match;
}

/**
 * Applies an incoming MQTT chunk to the message list.
 * Returns a new messages array. Pure function, no side effects.
 *
 * @param prev - The current message list.
 * @param data - The incoming chunk data to apply.
 * @param seenIds - Optional set of already-seen message IDs for deduplication.
 */
export function applyChunkToMessages(
  prev: ChatMessage[],
  data: IncomingChunk,
  seenIds?: Set<string>
): ChatMessage[] {
  // Prevent processing chunks for messages we've already finalized via API
  if (data.messageId && seenIds?.has(data.messageId)) {
    return prev;
  }

  // Find existing message with matching messageId
  const existingIndex = data.messageId
    ? prev.findIndex((m) => m.messageId === data.messageId && m.role === 'assistant')
    : -1;

  if (existingIndex !== -1) {
    const updated = [...prev];
    const existing = updated[existingIndex];
    const isFinal =
      (data as IncomingChunk & { 'detail-type'?: string })['detail-type'] === 'outbound_message';

    const isThought = !!(data.isThought || data.thought);

    updated[existingIndex] = {
      ...existing,
      content:
        !isThought || isFinal
          ? isFinal
            ? data.message ?? existing.content
            : (existing.content ?? '') + (data.message ?? '')
          : existing.content,
      thought:
        isThought || isFinal
          ? isFinal
            ? data.message || data.thought || existing.thought
            : (existing.thought ?? '') + (data.message || data.thought || '')
          : existing.thought,
      attachments: data.attachments ?? existing.attachments,
      tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
      options: data.options ?? existing.options,
      ui_blocks: data.ui_blocks ?? existing.ui_blocks,
    };
    return updated;
  }

  // No existing message found — check for exact content duplicate
  if (data.messageId && data.message) {
    const isExactDup = prev.some(
      (m) => m.messageId === data.messageId && m.content === data.message
    );
    if (isExactDup) return prev;
  }

  // Add new message
  return [
    ...prev,
    {
      role: 'assistant',
      content: data.isThought ? '' : (data.message ?? ''),
      thought: data.isThought ? (data.message || data.thought) : data.thought,
      messageId: data.messageId,
      agentName: data.agentName ?? 'SuperClaw',
      attachments: data.attachments,
      options: data.options,
      tool_calls: data.toolCalls || data.tool_calls,
      ui_blocks: data.ui_blocks,
      pageContext: data.pageContext,
    },
  ];
}

/**
 * Maps a raw history message from the API into a ChatMessage,
 * including the critical messageId field for deduplication.
 */
export function mapHistoryMessage(m: HistoryMessage): ChatMessage {
  return {
    role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
    content: m.content,
    thought: m.thought,
    agentName:
      m.agentName ?? (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
    attachments: m.attachments,
    options: m.options,
    tool_calls: m.tool_calls,
    messageId: m.messageId || m.traceId,
    ui_blocks: m.ui_blocks,
    pageContext: m.pageContext,
  };
}

/**
 * Merges fetched history with the current message list.
 * Preserves streaming placeholders and local-only messages not yet in history.
 * Returns the merged messages array and a set of seen message IDs.
 *
 * @param prev - The current local message list.
 * @param rawHistory - The history messages fetched from the API.
 */
export function mergeHistoryWithMessages(
  prev: ChatMessage[],
  rawHistory: HistoryMessage[]
): { messages: ChatMessage[]; seenIds: Set<string> } {
  const seenIds = new Set<string>();
  const historyKeys = new Set<string>();
  const uniqueHistory: ChatMessage[] = [];

  const normalizeId = (id: string, role: string) => {
    if (role !== 'assistant') return id;
    if (!id.includes('-')) return id;
    const parts = id.split('-');
    const suffix = parts[parts.length - 1];
    if (['superclaw', 'assistant', 'system'].includes(suffix)) {
      return parts.slice(0, -1).join('-');
    }
    return id;
  };

  rawHistory.forEach((m) => {
    const msg = mapHistoryMessage(m);
    if (!msg.messageId) {
      uniqueHistory.push(msg);
      return;
    }

    const normId = normalizeId(msg.messageId, msg.role);
    const key = `${msg.role}:${normId}`;

    if (!historyKeys.has(key)) {
      historyKeys.add(key);
      uniqueHistory.push(msg);
      seenIds.add(msg.messageId);
    }
  });

  // Preserve local-only messages:
  // 1. Assistant messages that are still streaming
  // 2. Error messages that are not in history
  const localOnly = prev.filter((m) => {
    if (!m.messageId) return false;
    if (m.role === 'user') return false;
    const normId = normalizeId(m.messageId, m.role);
    return !historyKeys.has(`${m.role}:${normId}`);
  });

  return { messages: [...uniqueHistory, ...localOnly], seenIds };
}
