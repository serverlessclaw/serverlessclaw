import { ChatMessage } from './types';

/**
 * Determines whether an incoming assistant message should be suppressed as a duplicate.
 *
 * Priority:
 * 1. If `messageId` is present → deduplicate by ID (stable, preferred).
 * 2. Otherwise → fall back to content-equality (covers background events without an ID).
 *
 * Returns `true` when the message is a duplicate and should be dropped.
 * As a side-effect, registers a new `messageId` in `seenIds` when the message is accepted.
 */
export function isDuplicate(
  seenIds: Set<string>,
  prev: ChatMessage[],
  messageId: string | undefined,
  content: string
): boolean {
  if (messageId) {
    if (seenIds.has(messageId)) return true;
    seenIds.add(messageId);
    return false;
  }
  return prev.some(m => m.role === 'assistant' && m.content === content);
}
