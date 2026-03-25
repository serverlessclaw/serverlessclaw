import { describe, it, expect, beforeEach } from 'vitest';
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
        userId: 'user-1',
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns true when chunk sessionId matches active session', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = { 
        message: 'Hello', 
        userId: 'user-1', 
        sessionId: 'sess-1',
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns false when chunk sessionId does not match active session', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = { 
        message: 'Hello', 
        userId: 'user-1', 
        sessionId: 'sess-2',
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });

  it('returns true even when chunk has no message and no thought (may have options/tools)', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = { 
        userId: 'user-1', 
        sessionId: 'sess-1',
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns true when chunk has empty message but isThought is set', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = { 
        userId: 'user-1', 
        sessionId: 'sess-1', 
        message: '', 
        isThought: true,
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(true);
  });

  it('returns false when chunk userId does not match', () => {
    const chunk: IncomingChunk & { 'detail-type': string } = { 
        message: 'Hello', 
        userId: 'other-user', 
        sessionId: 'sess-1',
        'detail-type': 'chunk'
    };
    expect(shouldProcessChunk(chunk, 'sess-1', 'user-1')).toBe(false);
  });
});

describe('applyChunkToMessages', () => {
  let seenIds: Set<string>;

  beforeEach(() => {
    seenIds = new Set<string>();
  });

  it('appends a new assistant message on first chunk', () => {
    const prev: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const chunk: IncomingChunk = {
      message: 'Hello',
      messageId: 'trace-1',
      agentName: 'SuperClaw',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      messageId: 'trace-1',
      agentName: 'SuperClaw',
    });
  });

  it('appends content to existing message on subsequent chunks', () => {
    const prev: ChatMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hel', messageId: 'trace-1', agentName: 'SuperClaw' },
    ];
    const chunk: IncomingChunk = { message: 'lo', messageId: 'trace-1' };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Hello');
  });

  it('accumulates thought chunks on existing message', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: '', thought: 'Let me', messageId: 'trace-1', agentName: 'SuperClaw' },
    ];
    const chunk: IncomingChunk = { message: ' think', messageId: 'trace-1', isThought: true };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].thought).toBe('Let me think');
    expect(result[0].content).toBe('');
  });

  it('creates thought-only message for first thought chunk', () => {
    const prev: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const chunk: IncomingChunk = {
      message: 'Thinking...',
      messageId: 'trace-1',
      isThought: true,
      agentName: 'SuperClaw',
    };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      role: 'assistant',
      content: '',
      thought: 'Thinking...',
      messageId: 'trace-1',
    });
  });

  it('drops duplicate messages via isDuplicate', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Hello', messageId: 'trace-1', agentName: 'SuperClaw' },
    ];
    const chunk: IncomingChunk = { message: ' world', messageId: 'trace-1' };

    const result = applyChunkToMessages(prev, chunk);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello world');
  });

  it('preserves options on existing message when chunk has options', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Approve?', messageId: 'trace-1', agentName: 'SuperClaw' },
    ];
    const options = [{ label: 'Approve', value: 'APPROVE', type: 'primary' as const }];
    const chunk: IncomingChunk = { message: '', messageId: 'trace-1', options };

    const result = applyChunkToMessages(prev, chunk);

    expect(result[0].options).toEqual(options);
  });

  it('merges tool_calls from chunk into existing message', () => {
    const prev: ChatMessage[] = [
      { role: 'assistant', content: 'Calling tool...', messageId: 'trace-1', agentName: 'SuperClaw' },
    ];
    const toolCalls = [{ id: 'tc-1', type: 'function' as const, function: { name: 'test', arguments: '{}' } }];
    const chunk: IncomingChunk = { message: '', messageId: 'trace-1', toolCalls };

    const result = applyChunkToMessages(prev, chunk);

    expect(result[0].tool_calls).toEqual(toolCalls);
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
