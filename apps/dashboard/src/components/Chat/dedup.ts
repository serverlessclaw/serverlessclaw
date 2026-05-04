import { ChatMessage } from '@claw/hooks';

/**
 * Determines whether an incoming assistant message should be suppressed as a duplicate.
 *
 * Priority:
 * 1. If `messageId` is present → deduplicate ONLY if it already exists in the UI state.
 *    This allows a full POST response to "win" over a partial MQTT signal with the same ID.
 * 2. Otherwise → fall back to content-equality (covers background events without an ID).
 *
 * @param seenIds - Set of message IDs already seen in this session.
 * @param prev - Array of previous chat messages in the UI state.
 * @param messageId - Optional message ID for ID-based deduplication.
 * @param content - The message content for content-based fallback deduplication.
 * @returns `true` when the message is a duplicate and should be dropped.
 */
export function isDuplicate(
  seenIds: Set<string>,
  prev: ChatMessage[],
  messageId: string | undefined,
  content: string
): boolean {
  if (messageId) {
    const existsInState = prev.some((m) => m.messageId === messageId);
    if (existsInState) {
      return true;
    }
    seenIds.add(messageId);
    return false;
  }

  // For empty content (processing/tool delegation), only deduplicate if we already have an empty one from assistant
  if (content === '') {
    return prev.some((m) => m.role === 'assistant' && m.content === '');
  }

  return prev.some((m) => m.role === 'assistant' && m.content === content);
}
