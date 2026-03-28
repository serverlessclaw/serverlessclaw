import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../critic';

const agentMocks = vi.hoisted(() => ({
  process: vi.fn(),
  executeTool: vi.fn(),
}));

const emitTaskEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    initAgent: vi.fn().mockResolvedValue({
      config: { id: 'critic', name: 'Critic Agent', enabled: true },
      memory: {},
      agent: {
        process: agentMocks.process,
        executeTool: agentMocks.executeTool,
      },
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
    agentMocks.executeTool.mockResolvedValue(JSON.stringify({ success: true }));
  });

  it('should join collaboration and share verdict when collaborationId is provided', async () => {
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

    // 1. Verify joinCollaboration was called
    expect(agentMocks.executeTool).toHaveBeenCalledWith('joinCollaboration', {
      collaborationId: 'collab-456',
    });

    // 2. Verify writeToCollaboration was called with the verdict
    expect(agentMocks.executeTool).toHaveBeenCalledWith(
      'writeToCollaboration',
      expect.objectContaining({
        collaborationId: 'collab-456',
        content: expect.stringContaining('CRITIC VERDICT: APPROVED'),
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

    expect(agentMocks.executeTool).not.toHaveBeenCalledWith(
      'joinCollaboration',
      expect.any(Object)
    );
    expect(agentMocks.executeTool).not.toHaveBeenCalledWith(
      'writeToCollaboration',
      expect.any(Object)
    );
  });
});
