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
  agentName?: string;
  attachments?: ChatMessage['attachments'];
  options?: ChatMessage['options'];
  toolCalls?: ChatMessage['tool_calls'];
  tool_calls?: ChatMessage['tool_calls'];
}

/**
 * Determines if an incoming MQTT chunk should be processed based on session routing.
 */
export function shouldProcessChunk(
  data: IncomingChunk & { 'detail-type'?: string },
  currentActiveId: string,
  expectedUserId: string
): boolean {
  // Normalize incoming userId (remove CONV# prefix if present)
  const incomingUserId = data.userId?.startsWith('CONV#') 
    ? data.userId.split('#')[1] 
    : data.userId;

  if (incomingUserId !== expectedUserId) {
    return false;
  }
  
  const type = data['detail-type'];
  if (type !== 'chunk' && type !== 'outbound_message') {
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
    const isFinal = (data as IncomingChunk & { 'detail-type'?: string })['detail-type'] === 'outbound_message';
    
    if (data.isThought) {
      updated[existingIndex] = {
        ...existing,
        thought: isFinal ? (data.message ?? existing.thought) : (existing.thought ?? '') + (data.message ?? ''),
        options: data.options ?? existing.options,
      };
    } else {
      updated[existingIndex] = {
        ...existing,
        content: isFinal ? (data.message ?? existing.content) : (existing.content ?? '') + (data.message ?? ''),
        attachments: data.attachments ?? existing.attachments,
        tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
        options: data.options ?? existing.options,
      };
    }
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
      thought: data.isThought ? data.message : undefined,
      messageId: data.messageId,
      agentName: data.agentName ?? 'SuperClaw',
      attachments: data.attachments,
      options: data.options,
      tool_calls: data.toolCalls || data.tool_calls,
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
    agentName: m.agentName ?? (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
    attachments: m.attachments,
    options: m.options,
    tool_calls: m.tool_calls,
    messageId: m.messageId || m.traceId,
  };
}

/**
 * Merges fetched history with the current message list.
 * Preserves streaming placeholders and local-only messages not yet in history.
 * Returns the merged messages array and a set of seen message IDs.
 */
export function mergeHistoryWithMessages(
  prev: ChatMessage[],
  rawHistory: HistoryMessage[]
): { messages: ChatMessage[]; seenIds: Set<string> } {
  const seenIds = new Set<string>();
  const history = rawHistory.map(mapHistoryMessage);

  // Track unique message identifiers from history for dedup.
  // We use a combination of messageId and role because a turn (user + assistant) shares the same traceId.
  const historyKeys = new Set<string>();
  history.forEach((m) => {
    if (m.messageId) {
      seenIds.add(m.messageId);
      historyKeys.add(`${m.role}:${m.messageId}`);
    }
  });

  // Preserve local-only messages:
  // 1. Assistant messages that are still streaming (not yet in history with 'assistant' role)
  // 2. Error messages (SystemGuard) that are not in history
  const localOnly = prev.filter((m) => {
    if (!m.messageId) return false;
    // If it's a user message, we prefer the history version (which has the real ID)
    if (m.role === 'user') return false;
    // If it's an assistant message, keep it if it's NOT in history yet
    return !historyKeys.has(`${m.role}:${m.messageId}`);
  });

  return { messages: [...history, ...localOnly], seenIds };
}
