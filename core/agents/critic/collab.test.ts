import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../critic';

const agentMocks = vi.hoisted(() => ({
  process: vi.fn(),
}));

const memoryMocks = vi.hoisted(() => ({
  getCollaboration: vi.fn(),
  checkCollaborationAccess: vi.fn(),
  addMessage: vi.fn(),
}));

const emitTaskEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    initAgent: vi.fn().mockResolvedValue({
      config: { id: 'critic', name: 'Critic Agent', enabled: true },
      memory: memoryMocks,
      agent: {
        process: agentMocks.process,
      },
    }),
    getAgentContext: vi.fn().mockResolvedValue({
      memory: memoryMocks,
    }),
    extractPayload: vi.fn((event: any) => event.detail || event),
    validatePayload: vi.fn(() => true),
    buildProcessOptions: vi.fn((opts: any) => opts),
    isTaskPaused: vi.fn(() => false),
  };
});

vi.mock('../../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: emitTaskEventMock,
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

describe('Critic Agent Collaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.process.mockResolvedValue({
      responseText: JSON.stringify({
        verdict: 'APPROVED',
        reviewMode: 'security',
        confidence: 9,
        findings: [],
        summary: 'Looks good',
      }),
      attachments: [],
    });
  });

  it('should join collaboration and share verdict when collaborationId is provided', async () => {
    memoryMocks.getCollaboration.mockResolvedValue({
      collaborationId: 'collab-456',
      syntheticUserId: 'synth-user-123',
    });
    memoryMocks.checkCollaborationAccess.mockResolvedValue(true);

    const event = {
      detail: {
        userId: 'user-1',
        task: 'Review this plan',
        metadata: {
          reviewMode: 'security',
          planId: 'plan-123',
          collaborationId: 'collab-456',
        },
        traceId: 'trace-789',
        initiatorId: 'planner',
      },
    };

    await handler(event as any, {} as any);

    // 1. Verify getCollaboration was called
    expect(memoryMocks.getCollaboration).toHaveBeenCalledWith('collab-456');

    // 2. Verify checkCollaborationAccess was called
    expect(memoryMocks.checkCollaborationAccess).toHaveBeenCalledWith(
      'collab-456',
      'critic',
      'agent',
      'editor'
    );

    // 3. Verify addMessage was called with the verdict
    expect(memoryMocks.addMessage).toHaveBeenCalledWith(
      'synth-user-123',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('CRITIC VERDICT: APPROVED'),
        agentName: 'critic',
      })
    );
  });

  it('should NOT join collaboration when collaborationId is missing', async () => {
    const event = {
      detail: {
        userId: 'user-1',
        task: 'Review this plan',
        metadata: {
          reviewMode: 'security',
          planId: 'plan-123',
        },
      },
    };

    await handler(event as any, {} as any);

    expect(memoryMocks.getCollaboration).not.toHaveBeenCalled();
    expect(memoryMocks.checkCollaborationAccess).not.toHaveBeenCalled();
    expect(memoryMocks.addMessage).not.toHaveBeenCalled();
  });
});
