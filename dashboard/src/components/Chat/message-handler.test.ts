import { describe, it, expect } from 'vitest';
import {
  applyChunkToMessages,
  shouldProcessChunk,
  mapHistoryMessage,
  mergeHistoryWithMessages,
  IncomingChunk,
} from './message-handler';
import { ChatMessage, HistoryMessage } from './types';

describe('shouldProcessChunk', () => {
  it('returns true when chunk has no sessionId (general topic)', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'user-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('normalizes incoming userId by stripping CONV# prefix', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'CONV#user-1#sess-1',
      sessionId: 'sess-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('handles incoming userId with CONV# prefix but no additional # segments', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'CONV#user-1',
      sessionId: 'sess-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns true when chunk sessionId matches active session', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns false when chunk sessionId does not match active session', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'user-1',
      sessionId: 'sess-2',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });

  it('returns true even when chunk has no message and no thought (may have options/tools)', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      messageId: 'trace-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns true when chunk has empty message but isThought is set', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      userId: 'user-1',
      messageId: 'trace-1',
      sessionId: 'sess-1',
      message: '',
      isThought: true,
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns false when chunk userId does not match', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'other-user',
      sessionId: 'sess-1',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });

  it('returns true for outbound_message event type for final synchronization', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      messageId: 'trace-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      'detail-type': 'outbound_message',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns false when chunk is missing messageId', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Hello',
      userId: 'user-1',
      sessionId: 'sess-1',
      'detail-type': 'TEXT_MESSAGE_CONTENT',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });

  it('treats dashboard-user as wildcard and allows session-matched chunks', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'streaming chunk',
      messageId: 'trace-2',
      userId: 'session_abc123',
      sessionId: 'sess-1',
      'detail-type': 'TEXT_MESSAGE_CONTENT',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'dashboard-user')).toBe(true);
  });

  it('still rejects session-mismatched chunks for dashboard-user wildcard', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'streaming chunk',
      messageId: 'trace-3',
      userId: 'session_abc123',
      sessionId: 'sess-2',
      'detail-type': 'TEXT_MESSAGE_CONTENT',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'dashboard-user')).toBe(false);
  });

  it('returns false when userId mismatch', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = {
      messageId: 't1',
      userId: 'other-user',
      'detail-type': 'chunk',
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });
});

describe('applyChunkToMessages', () => {
  it('links chunk to a thinking placeholder if messageId is new', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: '', isThinking: true, agentName: 'SuperClaw' }
    ];
    const chunk: IncomingChunk = {
      message: 'Initial content',
      messageId: 'new-trace-id',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('new-trace-id');
    expect(result[0].content).toBe('Initial content');
    expect(result[0].isThinking).toBe(false);
  });

  it('replaces content instead of appending when detail-type is outbound_message', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Partial...', messageId: 't1', agentName: 'SuperClaw' }
    ];
    const chunk: IncomingChunk & { 'detail-type': string } = {
      message: 'Full final response',
      messageId: 't1',
      'detail-type': 'outbound_message',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Full final response');
  });

  it('drops duplicate assistant messages based on exact content match', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Hello there', messageId: 't1', agentName: 'SuperClaw' }
    ];
    // Different messageId but same content
    const chunk: IncomingChunk = {
      message: 'Hello there',
      messageId: 't2',
    };

    const result = applyChunkToMessages(prev, chunk);

    // Should NOT add a new message
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('t1');
  });

  it('appends thought deltas to an existing message', () => {
    const prev: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        thought: 'I am ',
        messageId: 't1',
        agentName: 'SuperClaw',
      },
    ];
    const chunk: IncomingChunk = {
      isThought: true,
      thought: 'thinking',
      messageId: 't1',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].thought).toBe('I am thinking');
  });

  it('ignores the synthetic thinking marker \u2026 in accumulated thought but uses it to set isThinking', () => {
    const prev: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        isThinking: true,
        messageId: 't1',
        agentName: 'SuperClaw',
      },
    ];
    const chunk: IncomingChunk = {
      isThought: true,
      thought: '\u2026',
      messageId: 't1',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].thought).toBeUndefined();
    expect(result[0].isThinking).toBe(true);
  });

  it('stops thinking when non-thought content arrives', () => {
    const prev: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        isThinking: true,
        messageId: 't1',
        agentName: 'SuperClaw',
      },
    ];
    const chunk: IncomingChunk = {
      message: 'Here is the answer',
      messageId: 't1',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Here is the answer');
    expect(result[0].isThinking).toBe(false);
  });

  it('skips chunks for already seen message IDs', () => {
    const prev: ChatMessage[] = [];
    const seenIds = new Set(['trace-1']);
    const chunk: IncomingChunk = { message: 'hi', messageId: 'trace-1' };

    const result = applyChunkToMessages(prev, chunk, seenIds);

    expect(result).toHaveLength(0);
  });
});

describe('mergeHistoryWithMessages', () => {
  it('discards local assistant messages if history has the same normalized ID', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Local version', messageId: 'trace-1-superclaw' }
    ];
    const rawHistory: HistoryMessage[] = [
      { role: 'assistant', content: 'History version', traceId: 'trace-1', attachments: [] }
    ];

    const { messages } = mergeHistoryWithMessages(prev, rawHistory);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('History version');
  });

  it('discards local user messages if they match history content', () => {
    const prev: ChatMessage[] = [
      { role: 'user', content: 'Same user text' }
    ];
    const rawHistory: HistoryMessage[] = [
      { role: 'user', content: 'Same user text', attachments: [] }
    ];

    const { messages } = mergeHistoryWithMessages(prev, rawHistory);

    expect(messages).toHaveLength(1);
  });
});

describe('mapHistoryMessage', () => {
  it('maps traceId to messageId for deduplication', () => {
    const historyMsg: HistoryMessage = {
      role: 'assistant',
      content: 'Hello',
      traceId: 'trace-abc',
      agentName: 'SuperClaw',
      attachments: undefined,
    };

    const result = mapHistoryMessage(historyMsg);

    expect(result.messageId).toBe('trace-abc');
  });

  it('prioritizes messageId over traceId if present', () => {
    const historyMsg: HistoryMessage = {
      role: 'assistant',
      content: 'Hello',
      traceId: 'trace-abc',
      messageId: 'fine-grained-id',
      agentName: 'SuperClaw',
      attachments: undefined,
    };

    const result = mapHistoryMessage(historyMsg);

    expect(result.messageId).toBe('fine-grained-id');
  });

  it('maps system role to assistant role and preserves thought', () => {
    const historyMsg: HistoryMessage = {
      role: 'assistant',
      content: 'Result',
      thought: 'Thinking...',
      traceId: 'trace-t',
      attachments: undefined,
    };

    const result = mapHistoryMessage(historyMsg);

    expect(result.role).toBe('assistant');
    expect(result.thought).toBe('Thinking...');
  });
});

describe('mergeHistoryWithMessages', () => {
  it('maps history messages and includes messageId', () => {
    const prev: ChatMessage[] = [];
    const rawHistory: HistoryMessage[] = [
      { role: 'user', content: 'Hello', attachments: undefined },
      { role: 'assistant', content: 'Hi!', traceId: 'trace-1', attachments: undefined },
    ];

    const { messages } = mergeHistoryWithMessages(prev, rawHistory);

    expect(messages).toHaveLength(2);
    expect(messages[1].messageId).toBe('trace-1');
  });

  it('does NOT ignore history when streaming placeholders exist', () => {
    const prev: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '', messageId: 'trace-streaming', agentName: 'SuperClaw' },
    ];
    const rawHistory: HistoryMessage[] = [
      { role: 'user', content: 'Hello', attachments: undefined },
      { role: 'user', content: 'New message from history', attachments: undefined },
    ];

    const { messages } = mergeHistoryWithMessages(prev, rawHistory);

    // Should contain both user messages AND the streaming placeholder
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(messages.some((m) => m.messageId === 'trace-streaming')).toBe(true);
  });
});
