import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Core mocks ────────────────────────────────────────────────────────────────

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
      enabled: true,
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

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

vi.mock('@claw/core/lib/constants', () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, OK: 200 },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
}));

vi.mock('@/lib/constants', () => ({
  UI_STRINGS: { MISSING_MESSAGE: 'Missing message', API_CHAT_ERROR: 'Chat error' },
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, OK: 200 },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
  AUTH: { SESSION_USER_ID: 'session_user_id' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  body?: Record<string, unknown>,
  options: { method?: string; searchParams?: Record<string, string> } = {}
) {
  const searchParams = new URLSearchParams(options.searchParams);
  return {
    json: vi.fn().mockResolvedValue(body ?? {}),
    cookies: {
      get: vi.fn().mockReturnValue({ value: 'dashboard-user' }),
    },
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

  it('returns messageId from the stream chunks', async () => {
    async function* fakeStream() {
      yield { content: 'Hello', messageId: 'm1' };
      yield { content: ' world' };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'Hi', sessionId: 'sess-1' }));
    const data = await res.json();

    expect(data.messageId).toBe('m1');
    expect(data.reply).toBe('Hello world');
  });

  it('returns 400 when both text and attachments are missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('passes sessionId and traceId to agent.stream', async () => {
    async function* fakeStream() {
      yield { content: 'done' };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'task', sessionId: 'the-session', traceId: 't1' }));

    expect(mockStream).toHaveBeenCalledWith(
      'CONV#dashboard-user#the-session',
      'task',
      expect.objectContaining({ sessionId: 'the-session', traceId: 't1' })
    );
  });

  it('saves conversation meta with truncated final response', async () => {
    const longContent = 'A'.repeat(100);
    async function* fakeStream() {
      yield { content: longContent };
    }
    mockStream.mockReturnValue(fakeStream());

    const { POST } = await import('./route');
    await POST(makeRequest({ text: 'Hi', sessionId: 'sess-trunc' }));

    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-trunc',
      expect.objectContaining({
        lastMessage: 'A'.repeat(60) + '...',
      }),
      expect.objectContaining({ workspaceId: 'default' })
    );
  });

  it('returns 500 on agent stream error', async () => {
    async function* errorStream() {
      throw new Error('Agent failed');
    }
    mockStream.mockReturnValue(errorStream());

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'Hi', sessionId: 'sess-error' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Internal Server Error');
    expect(data.details).toBe('Agent failed');
  });

  it('handles tool calls in stream', async () => {
    async function* toolStream() {
      yield { content: 'Thinking' };
      yield { tool_calls: [{ id: 'c1', function: { name: 't1', arguments: '{}' } }] };
    }
    mockStream.mockReturnValue(toolStream());

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ text: 'use tool', sessionId: 's1' }));
    const data = await res.json();

    expect(data.tool_calls).toHaveLength(1);
    expect(data.tool_calls[0].function.name).toBe('t1');
  });
});

describe('Dashboard API: PATCH /api/chat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates conversation metadata', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(makeRequest({ sessionId: 's1', title: 'New' }));
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      's1',
      expect.objectContaining({ title: 'New' }),
      expect.objectContaining({ workspaceId: 'default' })
    );
  });
});

describe('Dashboard API: DELETE /api/chat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a session', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(makeRequest(undefined, { searchParams: { sessionId: 's1' } }));
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 's1', {
      workspaceId: 'default',
    });
  });
});

describe('Dashboard API: GET /api/chat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sessions', async () => {
    mockListConversations.mockResolvedValue([{ sessionId: 's1' }]);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(undefined, { searchParams: {} }));
    const data = await res.json();

    expect(data.sessions).toHaveLength(1);
    expect(mockListConversations).toHaveBeenCalledWith('dashboard-user', {
      workspaceId: 'default',
    });
  });

  it('returns history', async () => {
    mockGetHistory.mockResolvedValue([{ role: 'user', content: 'hi' }]);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(undefined, { searchParams: { sessionId: 's1' } }));
    const data = await res.json();

    expect(data.history).toHaveLength(1);
    expect(mockGetHistory).toHaveBeenCalledWith('CONV#dashboard-user#s1', {
      workspaceId: 'default',
    });
  });
});
