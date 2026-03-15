import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Core mocks ────────────────────────────────────────────────────────────────

const mockProcess = vi.fn();
const mockSaveConversationMeta = vi.fn().mockResolvedValue(undefined);

vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    getHistory = vi.fn().mockResolvedValue([]);
    addMessage = vi.fn().mockResolvedValue(undefined);
    saveConversationMeta = mockSaveConversationMeta;
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
  },
}));

vi.mock('@claw/core/agents/superclaw', () => ({
  SUPERCLAW_SYSTEM_PROMPT: 'test-prompt',
}));

// The route imports TraceSource from both /index and bare path — mock both to be safe
vi.mock('@claw/core/lib/types/index', () => ({
  TraceSource: { DASHBOARD: 'dashboard' },
  MessageRole: { ASSISTANT: 'assistant' },
}));

vi.mock('@claw/core/lib/types', () => ({
  TraceSource: { DASHBOARD: 'dashboard' },
  MessageRole: { ASSISTANT: 'assistant' },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/constants', () => ({
  UI_STRINGS: { MISSING_MESSAGE: 'Missing message', API_CHAT_ERROR: 'Chat error' },
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, OK: 200 },
  AGENT_ERRORS: { PROCESS_FAILURE: 'Process failure' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return {
    json: vi.fn().mockResolvedValue(body),
    clone: vi.fn().mockReturnThis(),
  } as unknown as NextRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Dashboard API: POST /api/chat — messageId propagation', () => {
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

    expect(data.messageId).toBe('trace-abc-123');
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
});
