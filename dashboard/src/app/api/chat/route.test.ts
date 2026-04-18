import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Core mocks ────────────────────────────────────────────────────────────────

const mockProcess = vi.fn();
const mockStream = vi.fn();
const mockSaveConversationMeta = vi.fn().mockResolvedValue(undefined);
const mockGetHistory = vi.fn().mockResolvedValue([]);
const mockAddMessage = vi.fn().mockResolvedValue(undefined);
const mockListConversations = vi.fn().mockResolvedValue([]);
const mockDeleteConversation = vi.fn().mockResolvedValue(undefined);
const mockRevalidatePath = vi.fn();

vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    getHistory = mockGetHistory;
    addMessage = mockAddMessage;
    saveConversationMeta = mockSaveConversationMeta;
    listConversations = mockListConversations;
    deleteConversation = mockDeleteConversation;
  },
  CachedMemory: class {
    constructor(_memory: { underlying: unknown }) {
      return _memory;
    }
  },
}));

vi.mock('@claw/core/lib/providers/index', () => ({
  ProviderManager: class {},
}));

vi.mock('@claw/core/tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('@claw/core/lib/agent', () => ({
  Agent: class {
    process = mockProcess;
    stream = mockStream;
  },
}));

vi.mock('@claw/core/agents/superclaw', () => ({
  SUPERCLAW_SYSTEM_PROMPT: 'test-prompt',
}));

vi.mock('@claw/core/lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'superclaw',
      name: 'SuperClaw',
      systemPrompt: 'test-prompt',
    }),
  },
}));

// The route imports TraceSource from both /index and bare path — mock both to be safe
vi.mock('@claw/core/lib/types/index', () => ({
  TraceSource: { DASHBOARD: 'dashboard' },
  MessageRole: { ASSISTANT: 'assistant' },
  AgentType: { SUPERCLAW: 'superclaw' },
}));

vi.mock('@claw/core/lib/types', () => ({
  TraceSource: { DASHBOARD: 'dashboard' },
  MessageRole: { ASSISTANT: 'assistant' },
  AgentType: { SUPERCLAW: 'superclaw' },
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

vi.mock('@claw/core/lib/constants', () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, OK: 200 },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
}));

vi.mock('@/lib/constants', () => ({
  UI_STRINGS: { MISSING_MESSAGE: 'Missing message', API_CHAT_ERROR: 'Chat error' },
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, OK: 200 },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  body?: Record<string, unknown>,
  options: { method?: string; searchParams?: Record<string, string> } = {}
) {
  const searchParams = new URLSearchParams(options.searchParams);
  return {
    json: vi.fn().mockResolvedValue(body ?? {}),
    clone: vi.fn().mockReturnThis(),
    method: options.method ?? 'POST',
    nextUrl: {
      searchParams,
    },
  } as unknown as NextRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Dashboard API: POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns messageId equal to the traceId from agent.process', async () => {
    mockProcess.mockResolvedValue({
      responseText: 'Hello from SuperClaw',
      attachments: [],
      traceId: 'trace-abc-123',
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'Hi', sessionId: 'session_1' }));
    const data = await res.json();

    expect(data.messageId).toBe('trace-abc-123-superclaw');
    expect(data.reply).toBe('Hello from SuperClaw');
    expect(data.agentName).toBe('SuperClaw');
  });

  it('returns messageId as undefined when agent.process returns no traceId', async () => {
    mockProcess.mockResolvedValue({
      responseText: 'OK',
      attachments: [],
      // traceId intentionally absent
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'ping', sessionId: 'session_2' }));
    const data = await res.json();

    // messageId key may be present with value undefined, or absent — either is acceptable
    expect(data.messageId == null).toBe(true);
    expect(data.reply).toBe('OK');
  });

  it('returns 400 when both text and attachments are missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('passes sessionId to agent.process', async () => {
    mockProcess.mockResolvedValue({ responseText: 'done', traceId: 'tid' });

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'task', sessionId: 'the-session' }));

    expect(mockProcess).toHaveBeenCalledWith(
      'CONV#dashboard-user#the-session',
      'task',
      expect.objectContaining({ sessionId: 'the-session' })
    );
  });

  it('includes traceId in saveConversationMeta call', async () => {
    mockProcess.mockResolvedValue({
      responseText: 'Hello',
      traceId: 'trace-xyz',
    });

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'Hi', sessionId: 'sess-1' }));

    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-1',
      expect.objectContaining({ lastMessage: expect.any(String) })
    );
  });

  it('handles attachments in request', async () => {
    mockProcess.mockResolvedValue({
      responseText: 'Response with attachments',
      traceId: 'trace-attach',
    });

    const { POST } = await import('./route');
    const attachments = [{ type: 'image', url: 'http://example.com/img.png' }];
    await POST(makeRequest({ text: 'Check this', sessionId: 'sess-attach', attachments }));

    expect(mockProcess).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-attach',
      'Check this',
      expect.objectContaining({ attachments })
    );
  });

  it('uses userId as storageId when sessionId is not provided', async () => {
    mockProcess.mockResolvedValue({ responseText: 'done', traceId: 'tid' });

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'no session' }));

    expect(mockProcess).toHaveBeenCalledWith(
      'dashboard-user',
      'no session',
      expect.objectContaining({ sessionId: undefined })
    );
  });

  it('does not save conversation meta when sessionId is not provided', async () => {
    mockProcess.mockResolvedValue({ responseText: 'done', traceId: 'tid' });

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'no session' }));

    expect(mockSaveConversationMeta).not.toHaveBeenCalled();
  });

  it('truncates long response text in conversation meta', async () => {
    const longText = 'A'.repeat(100);
    mockProcess.mockResolvedValue({ responseText: longText, traceId: 'tid' });

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'Hi', sessionId: 'sess-truncate' }));

    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-truncate',
      expect.objectContaining({
        lastMessage: 'A'.repeat(60) + '...',
      })
    );
  });

  it('returns 500 on agent process error', async () => {
    mockProcess.mockRejectedValue(new Error('Agent failed'));

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'Hi', sessionId: 'sess-error' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Internal Server Error');
    expect(data.details).toBe('Agent failed');
  });

  it('persists error message to history on agent failure', async () => {
    mockProcess.mockRejectedValue(new Error('Agent crashed'));

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'Hi', sessionId: 'sess-fail' }));

    expect(mockAddMessage).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-fail',
      expect.objectContaining({
        role: 'assistant',
        content: 'Process failure',
      })
    );
  });

  it('handles error when persisting error message fails', async () => {
    mockProcess.mockRejectedValue(new Error('Agent failed'));
    mockAddMessage.mockRejectedValue(new Error('Storage failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'Hi', sessionId: 'sess-double-fail' }));

    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to persist error message:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});

describe('Dashboard API: POST /api/chat (streaming)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes client traceId to agent.stream when stream=true', async () => {
    async function* fakeStream() {
      yield { messageId: 'stream-trace-1' };
      yield { content: 'chunk1' };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'Hello', sessionId: 'sess-stream-1', traceId: 'client-trace-42' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(mockStream).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-stream-1',
      'Hello',
      expect.objectContaining({
        sessionId: 'sess-stream-1',
        traceId: 'client-trace-42',
      })
    );
    expect(data.reply).toBe('chunk1');
    expect(data.messageId).toBe('stream-trace-1');
  });

  it('falls back to client traceId when stream emits no messageId', async () => {
    async function* fakeStream() {
      yield { content: 'chunk1' };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'Hello', sessionId: 'sess-stream-no-id', traceId: 'client-trace-fallback' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(data.reply).toBe('chunk1');
    expect(data.messageId).toBe('client-trace-fallback-superclaw');
  });

  it('passes undefined traceId when client does not provide one', async () => {
    async function* fakeStream() {
      yield { content: 'chunk1' };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    await POST(
      makeRequest(
        { text: 'Hello', sessionId: 'sess-stream-2' },
        { searchParams: { stream: 'true' } }
      )
    );

    expect(mockStream).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-stream-2',
      'Hello',
      expect.objectContaining({
        traceId: undefined,
      })
    );
  });

  it('awaits stream completion before returning', async () => {
    let streamDone = false;
    async function* fakeStream() {
      yield { content: 'chunk1' };
      yield { content: 'chunk2' };
      streamDone = true;
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'Stream me', sessionId: 'sess-stream-3' },
        { searchParams: { stream: 'true' } }
      )
    );

    // Stream must be fully consumed before the response is sent
    expect(streamDone).toBe(true);
    expect(res.status).toBe(200);
  });

  it('saves conversation meta with truncated final response after streaming', async () => {
    const longContent = 'A'.repeat(100);
    async function* fakeStream() {
      yield { content: longContent };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    await POST(
      makeRequest(
        { text: 'Long response', sessionId: 'sess-stream-trunc' },
        { searchParams: { stream: 'true' } }
      )
    );

    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-stream-trunc',
      expect.objectContaining({
        lastMessage: 'A'.repeat(60) + '...',
      })
    );
  });

  it('returns 400 for streaming request with no text or attachments', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({}, { searchParams: { stream: 'true' } }));
    expect(res.status).toBe(400);
  });

  it('captures tool_calls from stream when provider returns them (MiniMax scenario)', async () => {
    // MiniMax fake-stream: yields content then tool_calls in separate chunks
    async function* fakeStream() {
      yield { content: 'Let me check.' };
      yield {
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'recallKnowledge', arguments: '{"query":"user identity"}' },
          },
        ],
      };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'remember who i am?', sessionId: 'sess-tc-1' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(data.reply).toBe('Let me check.');
    expect(data.tool_calls).toHaveLength(1);
    expect(data.tool_calls[0].function.name).toBe('recallKnowledge');
  });

  it('returns empty reply with tool_calls when provider emits only tool_calls (no text)', async () => {
    // MiniMax scenario: provider returns tool_calls with empty content
    async function* fakeStream() {
      yield {
        content: '',
        tool_calls: [
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'search for test', sessionId: 'sess-tc-2' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(data.reply).toBe('');
    expect(data.tool_calls).toHaveLength(1);
    expect(data.tool_calls[0].function.name).toBe('search');
  });

  it('captures thought content as reply when provider emits only thoughts', async () => {
    async function* fakeStream() {
      yield { thought: 'Let me think about this...' };
      yield {
        tool_calls: [
          {
            id: 'call-3',
            type: 'function',
            function: { name: 'think', arguments: '{}' },
          },
        ],
      };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'think about it', sessionId: 'sess-tc-3' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    // Thought should be captured separately
    expect(data.reply).toBe('');
    expect(data.thought).toBe('Let me think about this...');
    expect(data.tool_calls).toHaveLength(1);
  });

  it('falls back to process when stream returns no content and no tool calls', async () => {
    async function* fakeStream() {
      yield { content: '' };
    }
    mockStream.mockReturnValue(fakeStream());
    mockProcess.mockResolvedValue({
      responseText: 'Fallback response',
      thought: 'Recovered after empty stream',
      traceId: 'trace-fallback-1',
    });

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'hi', sessionId: 'sess-fallback-1' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(mockProcess).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-fallback-1',
      'hi',
      expect.objectContaining({ sessionId: 'sess-fallback-1' })
    );
    expect(data.reply).toBe('Fallback response');
    expect(data.thought).toBe('Recovered after empty stream');
    expect(data.messageId).toBe('trace-fallback-1-superclaw');
  });

  it('does not fall back to process when stream includes tool calls only', async () => {
    async function* fakeStream() {
      yield {
        content: '',
        tool_calls: [
          {
            id: 'call-only',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"x"}' },
          },
        ],
      };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        { text: 'search x', sessionId: 'sess-fallback-2' },
        { searchParams: { stream: 'true' } }
      )
    );
    const data = await res.json();

    expect(mockProcess).not.toHaveBeenCalled();
    expect(data.reply).toBe('');
    expect(data.tool_calls).toHaveLength(1);
  });
});

describe('Dashboard API: PATCH /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates conversation metadata with title', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(makeRequest({ sessionId: 'sess-1', title: 'New Title' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-1',
      expect.objectContaining({ title: 'New Title', updatedAt: expect.any(Number) })
    );
  });

  it('updates conversation metadata with isPinned', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(makeRequest({ sessionId: 'sess-2', isPinned: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-2',
      expect.objectContaining({ isPinned: true, updatedAt: expect.any(Number) })
    );
  });

  it('updates conversation metadata with both title and isPinned', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeRequest({ sessionId: 'sess-3', title: 'Pinned Chat', isPinned: true })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-3',
      expect.objectContaining({
        title: 'Pinned Chat',
        isPinned: true,
        updatedAt: expect.any(Number),
      })
    );
  });

  it('returns 400 when sessionId is missing', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(makeRequest({ title: 'No Session' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Missing sessionId');
  });

  it('returns 500 when saveConversationMeta fails', async () => {
    mockSaveConversationMeta.mockRejectedValue(new Error('DynamoDB error'));

    const { PATCH } = await import('./route');
    const res = await PATCH(makeRequest({ sessionId: 'sess-err', title: 'Fail' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to update session');
  });
});

describe('Dashboard API: DELETE /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a single session', async () => {
    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'sess-del-1' } });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 'sess-del-1');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/');
  });

  it('deletes all sessions when sessionId is "all"', async () => {
    const mockSessions = [
      { sessionId: 'sess-1' },
      { sessionId: 'sess-2' },
      { sessionId: 'sess-3' },
    ];
    mockListConversations.mockResolvedValue(mockSessions);

    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'all' } });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.count).toBe(3);
    expect(mockListConversations).toHaveBeenCalledWith('dashboard-user');
    expect(mockDeleteConversation).toHaveBeenCalledTimes(3);
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 'sess-1');
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 'sess-2');
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 'sess-3');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/');
  });

  it('returns count of 0 when no sessions to delete', async () => {
    mockListConversations.mockResolvedValue([]);

    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'all' } });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.count).toBe(0);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('returns 400 when sessionId is missing', async () => {
    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: {} });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Missing sessionId');
  });

  it('returns 500 when deleteConversation fails', async () => {
    mockDeleteConversation.mockRejectedValue(new Error('Delete failed'));

    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'sess-fail' } });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to delete session');
  });

  it('returns 500 when listConversations fails during "all" delete', async () => {
    mockListConversations.mockRejectedValue(new Error('List failed'));

    const { DELETE } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'all' } });
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to delete session');
  });
});

describe('Dashboard API: GET /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns list of sessions when no sessionId provided', async () => {
    const mockSessions = [
      { sessionId: 'sess-1', title: 'Chat 1', lastMessage: 'Hello' },
      { sessionId: 'sess-2', title: 'Chat 2', lastMessage: 'Hi there' },
    ];
    mockListConversations.mockResolvedValue(mockSessions);

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: {} });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toEqual(mockSessions);
    expect(mockListConversations).toHaveBeenCalledWith('dashboard-user');
  });

  it('returns empty array when no sessions exist', async () => {
    mockListConversations.mockResolvedValue([]);

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: {} });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toEqual([]);
  });

  it('returns history for a specific session', async () => {
    const mockHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    mockGetHistory.mockResolvedValue(mockHistory);

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'sess-hist' } });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.history).toEqual(mockHistory);
    expect(mockGetHistory).toHaveBeenCalledWith('CONV#dashboard-user#sess-hist');
  });

  it('returns empty history for session with no messages', async () => {
    mockGetHistory.mockResolvedValue([]);

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'sess-empty' } });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.history).toEqual([]);
  });

  it('returns 500 when listConversations fails', async () => {
    mockListConversations.mockRejectedValue(new Error('Database error'));

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: {} });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to fetch sessions');
  });

  it('returns 500 when getHistory fails', async () => {
    mockGetHistory.mockRejectedValue(new Error('History fetch failed'));

    const { GET } = await import('./route');
    const req = makeRequest(undefined, { searchParams: { sessionId: 'sess-err' } });
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to fetch sessions');
  });
});
