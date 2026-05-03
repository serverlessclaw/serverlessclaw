import { ChatMessage, HistoryMessage, IncomingChunk } from './types';
import { logger } from '@claw/core/lib/logger';

/**
 * Determines if an incoming MQTT chunk should be processed based on session routing.
 */
export function shouldProcessChunk(
  data: IncomingChunk & { 'detail-type'?: string; type?: string },
  currentActiveId: string,
  expectedUserId: string
): boolean {
  const type = data.type || data['detail-type'];

  const incomingUserId = data.userId?.startsWith('CONV#') ? data.userId.split('#')[1] : data.userId;
  const useStrictUserFilter = expectedUserId !== 'dashboard-user';

  if (useStrictUserFilter && incomingUserId !== expectedUserId) {
    return false;
  }

  const validTypes = [
    'chunk',
    'TEXT_MESSAGE_CONTENT',
    'outbound_message',
    'TEXT_MESSAGE_START',
    'TEXT_MESSAGE_END',
  ];
  if (type && !validTypes.includes(type)) {
    return false;
  }

  if (!data.messageId) {
    return false;
  }

  if (!currentActiveId || !data.sessionId) {
    return true;
  }

  return data.sessionId === currentActiveId;
}

/**
 * Applies an incoming MQTT chunk to the message list.
 */
export function applyChunkToMessages(
  prev: ChatMessage[],
  data: IncomingChunk,
  seenIds?: Set<string>
): ChatMessage[] {
  if (data.messageId && seenIds?.has(data.messageId)) {
    return prev;
  }

  const chunkType = (data as any).type || (data as any)['detail-type'];
  const isFinal = chunkType === 'outbound_message';

  const isThought = !!data.isThought;
  const isSyntheticThought = isThought && data.thought === '\u2026';
  const hasVisibleMessageContent = !!(data.message || data.ui_blocks);
  const thoughtDelta = isSyntheticThought ? '' : data.thought || '';

  const existingIndex = data.messageId
    ? prev.findIndex((m) => m.messageId === data.messageId && m.role === 'assistant')
    : -1;

  if (existingIndex !== -1) {
    const updated = [...prev];
    const existing = updated[existingIndex];
    const stopThinking = (hasVisibleMessageContent && !isThought) || isFinal;

    updated[existingIndex] = {
      ...existing,
      isThinking: existing.isThinking ? !stopThinking : false,
      content:
        !isThought || isFinal
          ? isFinal
            ? (data.message ?? existing.content)
            : (existing.content ?? '') + (data.message ?? '')
          : existing.content,
      thought: isThought
        ? thoughtDelta
          ? (existing.thought ?? '') + thoughtDelta
          : existing.thought
        : isFinal
          ? existing.thought && existing.thought.trim().length > 0
            ? existing.thought
            : data.thought || existing.thought || undefined
          : existing.thought,
      attachments: data.attachments ?? existing.attachments,
      tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
      options: data.options ?? existing.options,
      ui_blocks: data.ui_blocks ?? existing.ui_blocks,
      modelName: data.model || data.modelName || existing.modelName,
      usage: data.usage || existing.usage,
      createdAt: data.createdAt || existing.createdAt,
    };
    return updated;
  }

  const thinkingIndex = prev.findIndex((m) => m.role === 'assistant' && m.isThinking);
  if (thinkingIndex !== -1) {
    const updated = [...prev];
    const existing = updated[thinkingIndex];
    const stopThinking = (hasVisibleMessageContent && !isThought) || isFinal;

    updated[thinkingIndex] = {
      ...existing,
      messageId: data.messageId,
      isThinking: !stopThinking,
      content:
        !isThought || isFinal
          ? isFinal
            ? existing.content && existing.content.trim().length > 0
              ? existing.content
              : (data.message ?? '')
            : (data.message ?? '')
          : '',
      thought: isThought
        ? thoughtDelta
          ? (existing.thought ?? '') + thoughtDelta
          : existing.thought
        : isFinal
          ? existing.thought && existing.thought.trim().length > 0
            ? existing.thought
            : data.thought || existing.thought || '' || undefined
          : existing.thought || undefined,
      attachments: data.attachments ?? existing.attachments,
      tool_calls: data.toolCalls || data.tool_calls || existing.tool_calls,
      options: data.options ?? existing.options,
      ui_blocks: data.ui_blocks ?? existing.ui_blocks,
      modelName: data.model || data.modelName,
      usage: data.usage,
      createdAt: data.createdAt || Date.now(),
    };
    return updated;
  }

  if (data.message && data.message.trim().length > 0) {
    const isContentDup = prev.some((m) => m.role === 'assistant' && m.content === data.message);
    if (isContentDup) {
      return prev;
    }
  }

  const hasVisibleContent = !!(
    (data.message && data.message.trim().length > 0) ||
    thoughtDelta ||
    data.toolCalls ||
    data.tool_calls ||
    data.ui_blocks
  );
  const stopThinkingNew = hasVisibleContent || isFinal;

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
      modelName: data.model || data.modelName,
      usage: data.usage,
      createdAt: data.createdAt || Date.now(),
    },
  ];
}

/**
 * Maps a raw history message from the API into a ChatMessage.
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
    createdAt: m.createdAt,
    modelName: m.modelName,
    usage: m.usage,
  };
}

/**
 * Merges fetched history with the current message list.
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

  const hasAssistantInHistory = uniqueHistory.some((m) => m.role === 'assistant');

  const localOnly = prev.filter((m) => {
    if (!m.messageId) return false;
    if (m.isThinking && hasAssistantInHistory) return false;

    const isContentMatch = uniqueHistory.some(
      (hm) => hm.role === m.role && hm.content === m.content && m.content.trim().length > 0
    );
    if (isContentMatch) return false;

    const normId = normalizeId(m.messageId, m.role);
    const key = `${m.role}:${normId}`;
    return !historyKeys.has(key);
  });

  return { messages: [...uniqueHistory, ...localOnly], seenIds };
}
