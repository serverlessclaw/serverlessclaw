/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted Mocks ─────────────────────────────────────────────────────────────

const {
  mockStream,
  mockSaveConversationMeta,
  mockGetHistory,
  mockAddMessage,
  mockListConversations,
  mockDeleteConversation,
  mockRevalidatePath,
  mockGetIdentityManager,
} = vi.hoisted(() => ({
  mockStream: vi.fn(),
  mockSaveConversationMeta: vi.fn().mockResolvedValue(undefined),
  mockGetHistory: vi.fn().mockResolvedValue([]),
  mockAddMessage: vi.fn().mockResolvedValue(undefined),
  mockListConversations: vi.fn().mockResolvedValue([]),
  mockDeleteConversation: vi.fn().mockResolvedValue(undefined),
  mockRevalidatePath: vi.fn(),
  mockGetIdentityManager: vi.fn().mockResolvedValue({
    getUser: vi.fn().mockResolvedValue({ role: 'admin' }),
    hasPermission: vi.fn().mockResolvedValue(true),
  }),
}));

// Mock AWS clients globally
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    config = { protocol: 'https' };
    send = vi.fn().mockResolvedValue({});
  },
}));

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

vi.mock('@claw/core/lib/utils/error', () => ({
  formatErrorMessage: (e: any) => e?.message || String(e),
}));

vi.mock('@claw/core/lib/session/identity', () => ({
  getIdentityManager: mockGetIdentityManager,
  Permission: { TASK_CREATE: 'task:create' },
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

vi.mock('@claw/core/lib/types/index', () => ({
  TraceSource: { DASHBOARD: 'dashboard' },
  MessageRole: { ASSISTANT: 'assistant' },
  AgentType: { SUPERCLAW: 'superclaw' },
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

vi.mock('@claw/core/lib/constants', () => ({
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    INTERNAL_SERVER_ERROR: 500,
    OK: 200,
    TOO_MANY_REQUESTS: 429,
  },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
  RETENTION: { SESSION_METADATA_DAYS: 30 },
  TIME: { MS_PER_SECOND: 1000 },
}));

vi.mock('@/lib/constants', () => ({
  UI_STRINGS: { MISSING_MESSAGE: 'Missing message', API_CHAT_ERROR: 'Chat error' },
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    INTERNAL_SERVER_ERROR: 500,
    OK: 200,
    TOO_MANY_REQUESTS: 429,
  },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
  AUTH: { SESSION_USER_ID: 'session_user_id' },
  ROUTES: { CHAT: '/chat' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  const searchParams = new URLSearchParams((body.searchParams as any) || {});
  return {
    url: `http://localhost/api/chat?${searchParams.toString()}`,
    json: async () => body,
    nextUrl: { searchParams },
    cookies: {
      get: vi.fn().mockReturnValue({ value: 'dashboard-user' }),
    },
  } as unknown as NextRequest;
}

// ── Tests ────────────────────────────────────────────────────────────────────

import { GET, POST, PATCH, DELETE } from './route';

describe('Dashboard API: POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIdentityManager.mockResolvedValue({
      getUser: vi.fn().mockResolvedValue({ role: 'admin' }),
      hasPermission: vi.fn().mockResolvedValue(true),
    });
  });

  it('returns 400 when both text and attachments are missing', async () => {
    const res = await (POST as any)(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing message');
  });

  it('returns messageId from the stream chunks', async () => {
    async function* testStream() {
      yield { content: 'Hello ', thought: 'Thinking...', messageId: 'm1' };
      yield { content: 'world' };
    }
    mockStream.mockReturnValue(testStream());

    const res = await (POST as any)(makeRequest({ text: 'Hi', sessionId: 's1' }));
    const data = (await res.json()) as { messageId: string; reply: string };

    expect(data.messageId).toBe('m1');
    expect(data.reply).toBe('Hello world');
  });

  it('passes sessionId and traceId to agent.stream', async () => {
    async function* emptyStream(): AsyncGenerator<{ content: string }> {
      yield { content: '' };
    }
    mockStream.mockReturnValue(emptyStream());

    await (POST as any)(makeRequest({ text: 'task', sessionId: 'the-session', traceId: 't1' }));

    expect(mockStream).toHaveBeenCalledWith(
      'CONV#dashboard-user#the-session',
      'task',
      expect.objectContaining({
        sessionId: 'the-session',
        traceId: 't1',
      })
    );
  });

  it('saves conversation meta with truncated final response', async () => {
    async function* longStream(): AsyncGenerator<{ content: string }> {
      yield { content: 'A'.repeat(200) };
    }
    mockStream.mockReturnValue(longStream());

    await (POST as any)(makeRequest({ text: 'Hi', sessionId: 'sess-trunc' }));

    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      'sess-trunc',
      expect.objectContaining({
        lastMessage: 'A'.repeat(100) + '...',
      }),
      expect.anything()
    );
  });

  it('returns 500 on agent stream error', async () => {
    mockStream.mockImplementation(async function* (): AsyncGenerator<never> {
      throw new Error('Agent failed');
    });

    const res = await (POST as any)(makeRequest({ text: 'Hi' }));
    const data = (await res.json()) as { error: string; details: string };

    expect(res.status).toBe(500);
    expect(data.error).toBe('Internal Server Error');
    expect(data.details).toBe('Agent failed');
  });

  it('handles tool calls in stream', async () => {
    async function* toolStream(): AsyncGenerator<{
      content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }> {
      yield { content: 'Thinking' };
      yield { tool_calls: [{ id: 'c1', function: { name: 't1', arguments: '{}' } }] };
    }
    mockStream.mockReturnValue(toolStream());

    const res = await (POST as any)(makeRequest({ text: 'Use tool', sessionId: 's1' }));
    const data = (await res.json()) as { tool_calls: any[] };

    expect(data.tool_calls).toHaveLength(1);
    expect(data.tool_calls[0].function.name).toBe('t1');
  });
});

describe('Dashboard API: PATCH /api/chat', () => {
  it('updates conversation metadata', async () => {
    const res = await (PATCH as any)(makeRequest({ sessionId: 's1', title: 'New Title' }));
    expect(res.status).toBe(200);
    expect(mockSaveConversationMeta).toHaveBeenCalledWith(
      'dashboard-user',
      's1',
      expect.objectContaining({ title: 'New Title' }),
      expect.anything()
    );
  });
});

describe('Dashboard API: DELETE /api/chat', () => {
  it('deletes a session', async () => {
    const res = await (DELETE as any)(makeRequest({ searchParams: { sessionId: 's1' } }));
    expect(res.status).toBe(200);
    expect(mockDeleteConversation).toHaveBeenCalledWith('dashboard-user', 's1', expect.anything());
    expect(mockRevalidatePath).toHaveBeenCalledWith('/chat');
  });
});

describe('Dashboard API: GET /api/chat', () => {
  it('returns sessions', async () => {
    const mockSessions = [{ id: 's1', title: 'Session 1' }];
    mockListConversations.mockResolvedValueOnce(mockSessions);

    const res = await (GET as any)(makeRequest());
    const data = (await res.json()) as { sessions: any[] };

    expect(data.sessions).toEqual(mockSessions);
    expect(mockListConversations).toHaveBeenCalledWith('dashboard-user', expect.anything());
  });

  it('returns history', async () => {
    mockGetHistory.mockResolvedValueOnce([{ role: 'user', content: 'Hi' }]);

    const res = await (GET as any)(makeRequest({ searchParams: { sessionId: 's1' } }));
    const data = (await res.json()) as { history: any[] };

    expect(data.history).toHaveLength(1);
    expect(mockGetHistory).toHaveBeenCalledWith('CONV#dashboard-user#s1', expect.anything());
  });
});
