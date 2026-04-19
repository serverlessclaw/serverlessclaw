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
  const type = data.type || data['detail-type'];
  
  // DEBUG: Log session processing
  console.log(`[shouldProcessChunk] msg=${data.messageId?.substring(0, 8)}, type=${type}, incoming_session=${data.sessionId}, active_session=${currentActiveId}`);

  // Normalize incoming userId (remove CONV# prefix if present)
  const incomingUserId = data.userId?.startsWith('CONV#') ? data.userId.split('#')[1] : data.userId;
  const useStrictUserFilter = expectedUserId !== 'dashboard-user';

  if (useStrictUserFilter && incomingUserId !== expectedUserId) {
    console.warn(`[shouldProcessChunk] ❌ User mismatch: ${incomingUserId} !== ${expectedUserId}`);
    return false;
  }

  // ALLOW ALL VALID SIGNAL TYPES
  const validTypes = ['chunk', 'TEXT_MESSAGE_CONTENT', 'outbound_message', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_END'];
  if (type && !validTypes.includes(type)) {
    console.warn(`[shouldProcessChunk] ❌ Type mismatch: ${type}`);
    return false;
  }

  if (!data.messageId) {
    console.log(`[shouldProcessChunk] ⏭️  Skipping: no messageId`);
    return false;
  }

  // If no activeSessionId yet, accept the chunk (session will be set soon)
  if (!currentActiveId) {
    console.log(`[shouldProcessChunk] ⏩ No active session yet, accepting chunk`);
    return true;
  }

  if (!data.sessionId) {
    console.log(`[shouldProcessChunk] ⏩ No session in data, accepting chunk`);
    return true;
  }

  const match = data.sessionId === currentActiveId;
  if (!match) {
    console.warn(`[shouldProcessChunk] ❌ Session mismatch: ${data.sessionId} !== ${currentActiveId}`);
  } else {
    console.log(`[shouldProcessChunk] ✅ Session match: ${data.sessionId}`);
  }
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
    console.log(`[message-handler] ⏭️  Skipping already-seen ID: ${data.messageId?.substring(0, 12)}`);
    return prev;
  }

  // Check both 'detail-type' and 'type' for outbound_message
  const chunkType = (data as IncomingChunk & { type?: string; 'detail-type'?: string }).type
    || (data as IncomingChunk & { 'detail-type'?: string })['detail-type'];
  const isFinal = chunkType === 'outbound_message';

  // Use only data.isThought — data.thought can exist on non-thought chunks (e.g. OUTBOUND_MESSAGE)
  const isThought = !!data.isThought;
  const isSyntheticThought = isThought && data.thought === '\u2026';
  const hasVisibleMessageContent = !!(data.message || data.ui_blocks);
  const thoughtDelta = isSyntheticThought ? '' : (data.thought || '');

  // Find existing message with matching messageId
  const existingIndex = data.messageId
    ? prev.findIndex((m) => m.messageId === data.messageId && m.role === 'assistant')
    : -1;

  if (existingIndex !== -1) {
    const updated = [...prev];
    const existing = updated[existingIndex];
    const stopThinking = (hasVisibleMessageContent && !isThought) || isFinal;

    console.log(
      `[message-handler] merge: id=${data.messageId?.substring(0, 12)}, ` +
      `type=${chunkType ?? 'chunk'}, isFinal=${isFinal}, isThought=${isThought}, ` +
      `synthetic=${isSyntheticThought}, msgLen=${data.message?.length ?? 0}, ` +
      `existingLen=${existing.content?.length ?? 0}, wasThinking=${existing.isThinking}`
    );

    updated[existingIndex] = {
      ...existing,
      isThinking: existing.isThinking ? !stopThinking : false,
      content:
        !isThought || isFinal
          ? isFinal
            ? // For final message, favor the final ground truth from data.message
              (data.message ?? existing.content)
            : (existing.content ?? '') + (data.message ?? '')
          : existing.content,
      thought:
        isThought
          ? thoughtDelta
            ? (existing.thought ?? '') + thoughtDelta
            : existing.thought
          : isFinal
            ? (existing.thought && existing.thought.trim().length > 0)
              ? existing.thought
              : (data.thought || existing.thought) || undefined
            : existing.thought,
      attachments: data.attachments ?? existing.attachments,
      tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
      options: data.options ?? existing.options,
      ui_blocks: data.ui_blocks ?? existing.ui_blocks,
    };
    return updated;
  }

  // No exact ID match — check if we have a thinking placeholder
  const thinkingIndex = prev.findIndex((m) => m.role === 'assistant' && m.isThinking);
  if (thinkingIndex !== -1) {
    const updated = [...prev];
    const existing = updated[thinkingIndex];
    const stopThinking = (hasVisibleMessageContent && !isThought) || isFinal;

    console.log(
      `[message-handler] thinkingPlaceholder: id=${data.messageId?.substring(0, 12)}, ` +
      `type=${chunkType ?? 'chunk'}, isFinal=${isFinal}, isThought=${isThought}, ` +
      `synthetic=${isSyntheticThought}, msgLen=${data.message?.length ?? 0}`
    );

    updated[thinkingIndex] = {
      ...existing,
      messageId: data.messageId, // Inherit the real message ID
      isThinking: !stopThinking,
      content:
        !isThought || isFinal
          ? isFinal
            ? (existing.content && existing.content.trim().length > 0)
              ? existing.content
              : (data.message ?? '')
            : (data.message ?? '')
          : '',
      thought:
        isThought
          ? thoughtDelta
            ? (existing.thought ?? '') + thoughtDelta
            : existing.thought
          : isFinal
            ? (existing.thought && existing.thought.trim().length > 0)
              ? existing.thought
              : (data.thought || existing.thought || '') || undefined
            : existing.thought || undefined,
      attachments: data.attachments ?? existing.attachments,
      tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
      options: data.options ?? existing.options,
      ui_blocks: data.ui_blocks ?? existing.ui_blocks,
    };
    return updated;
  }

  // No placeholder found — check for exact content duplicate to prevent double-bubbles
  if (data.message && data.message.trim().length > 0) {
    const isContentDup = prev.some(
      (m) => m.role === 'assistant' && m.content === data.message
    );
    if (isContentDup) {
      console.log(`[message-handler] Dropping duplicate content chunk for ${data.messageId}`);
      return prev;
    }
  }

  // Add new message
  const hasVisibleContent = !!(
    (data.message && data.message.trim().length > 0) ||
    thoughtDelta ||
    data.toolCalls ||
    data.tool_calls ||
    data.ui_blocks
  );
  const stopThinkingNew = hasVisibleContent || isFinal;

  console.log(
    `[message-handler] addNew: id=${data.messageId?.substring(0, 12)}, ` +
    `type=${chunkType ?? 'chunk'}, isThought=${isThought}, ` +
    `msgLen=${data.message?.length ?? 0}, isThinking=${!stopThinkingNew}`
  );

  return [
    ...prev,
    {
      role: 'assistant',
      content: isThought ? '' : (data.message ?? ''),
      thought: thoughtDelta || undefined,
      messageId: data.messageId,
      agentName: data.agentName ?? 'SuperClaw',
      isThinking: !stopThinkingNew,
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
    
    // UUID-aware suffix removal: only strip if the suffix is a known agent ID
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
  const hasAssistantInHistory = uniqueHistory.some((m) => m.role === 'assistant');

  const localOnly = prev.filter((m) => {
    if (!m.messageId) return false;

    // Discard thinking placeholders if history already has assistant responses
    if (m.isThinking && hasAssistantInHistory) return false;
    
    // Exact content match check against history to prevent double-bubbles
    const isContentMatch = uniqueHistory.some(
      (hm) => hm.role === m.role && hm.content === m.content && m.content.trim().length > 0
    );
    if (isContentMatch) return false;

    const normId = normalizeId(m.messageId, m.role);
    const key = `${m.role}:${normId}`;
    const inHistory = historyKeys.has(key);
    
    return !inHistory;
  });

  return { messages: [...uniqueHistory, ...localOnly], seenIds };
}
