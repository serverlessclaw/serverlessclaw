import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './coder';
import { AgentType, GapStatus } from '../lib/types/agent';
import { sendOutboundMessage } from '../lib/outbound';
import { initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

// Mock dependencies
vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/trace-helper', () => ({
  addTraceStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/workspace-manager', () => ({
  createWorkspace: vi.fn().mockResolvedValue('/tmp/mock-workspace'),
  cleanupWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const mockMemory = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
}));

const mockAgent = vi.hoisted(() => ({
  process: vi.fn().mockResolvedValue({
    responseText: JSON.stringify({ status: 'SUCCESS', response: 'Completed task' }),
    attachments: [],
  }),
}));

vi.mock('../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/utils/agent-helpers')>();
  return {
    ...actual,
    initAgent: vi.fn().mockResolvedValue({
      config: { name: 'CoderAgent' },
      memory: mockMemory,
      agent: mockAgent,
    }),
  };
});

describe('Coder Agent', () => {
  const mockContext = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'chdir').mockImplementation(() => {});
  });

  it('should process a valid task and emit events', async () => {
    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        traceId: 'trace123',
        sessionId: 'session123',
        depth: 0,
      },
    } as any;

    const result = await handler(event, mockContext);

    expect(result).toBe('Completed task');
    expect(initAgent).toHaveBeenCalledWith(AgentType.CODER);
    expect(mockAgent.process).toHaveBeenCalled();
    expect(sendOutboundMessage).toHaveBeenCalledWith(
      AgentType.CODER,
      'user123',
      'Completed task',
      ['user123'],
      'session123',
      'CoderAgent',
      []
    );
    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.CODER,
        userId: 'user123',
        task: 'implement feature',
        response: 'Completed task',
      })
    );
  });

  it('should pass patch metadata in emitTaskEvent when patch is present in response', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        response: 'Completed with patch',
        patch: 'diff --git a/file.ts b/file.ts\n+new line',
      }),
      attachments: [],
    });

    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        traceId: 'trace123',
        sessionId: 'session123',
        depth: 0,
      },
    } as any;

    await handler(event, mockContext);

    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.CODER,
        userId: 'user123',
        response: 'Completed with patch',
        metadata: expect.objectContaining({
          patch: 'diff --git a/file.ts b/file.ts\n+new line',
        }),
      })
    );
  });

  it('should not include metadata when no patch is present', async () => {
    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        traceId: 'trace123',
        sessionId: 'session123',
        depth: 0,
      },
    } as any;

    await handler(event, mockContext);

    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.CODER,
        metadata: undefined,
      })
    );
  });

  it('should transition gaps to PROGRESS and DEPLOYED if no buildId', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        response: 'Completed',
        patch: 'diff-1', // Required for evolution tasks now
      }),
      attachments: [],
    });

    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        metadata: { gapIds: ['gap1', 'gap2'] },
      },
    } as any;

    await handler(event, mockContext);

    expect(mockMemory.updateGapStatus).toHaveBeenCalledWith('gap1', GapStatus.PROGRESS);
    expect(mockMemory.updateGapStatus).toHaveBeenCalledWith('gap2', GapStatus.PROGRESS);
    expect(mockMemory.updateGapStatus).toHaveBeenCalledWith('gap1', GapStatus.DEPLOYED);
    expect(mockMemory.updateGapStatus).toHaveBeenCalledWith('gap2', GapStatus.DEPLOYED);
  });

  it('should not update gap status to DEPLOYED if buildId is returned', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        response: 'Building',
        buildId: 'build456',
        patch: 'diff-2', // Required for evolution tasks now
      }),
      attachments: [],
    });

    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        metadata: { gapIds: ['gap1'] },
      },
    } as any;

    await handler(event, mockContext);

    expect(mockMemory.updateGapStatus).toHaveBeenCalledWith('gap1', GapStatus.PROGRESS);
    // Should NOT mark as DEPLOYED
    expect(mockMemory.updateGapStatus).not.toHaveBeenCalledWith('gap1', GapStatus.DEPLOYED);
  });

  it('should handle FAILED status correctly', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'FAILED', response: 'Compilation error' }),
      attachments: [],
    });

    const event = {
      detail: {
        userId: 'user123',
        task: 'fix bug',
        metadata: { gapIds: ['gap1'] },
      },
    } as any;

    await handler(event, mockContext);

    expect(sendOutboundMessage).toHaveBeenCalledWith(
      AgentType.CODER,
      'user123',
      'Compilation error',
      ['user123'],
      undefined,
      'CoderAgent',
      []
    );

    // Should not mark as deployed
    expect(mockMemory.updateGapStatus).not.toHaveBeenCalledWith('gap1', GapStatus.DEPLOYED);
  });

  it('should ignore invalid payload missing task or userId', async () => {
    const event = {
      detail: {
        task: 'no user id',
      },
    } as any;

    const result = await handler(event, mockContext);
    expect(result).toBeUndefined();
    expect(initAgent).not.toHaveBeenCalled();
  });

  it('should mark as FAILED if evolution task (gapIds present) does not provide a patch', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        response: 'Implemented without patch',
        // patch is missing
      }),
      attachments: [],
    });

    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        metadata: { gapIds: ['gap1'] },
      },
    } as any;

    const result = await handler(event, mockContext);

    expect(result).toContain('FAILED: Evolution task requires a technical patch');
    // Ensure it doesn't mark as DEPLOYED
    expect(mockMemory.updateGapStatus).not.toHaveBeenCalledWith('gap1', GapStatus.DEPLOYED);
  });

  it('should NOT mark gaps as PROGRESS when initAgent fails (Bug 2 regression)', async () => {
    // Simulate initAgent throwing during initialization
    vi.mocked(initAgent).mockRejectedValueOnce(new Error('LLM provider unavailable'));

    const event = {
      detail: {
        userId: 'user123',
        task: 'implement feature',
        metadata: { gapIds: ['gap1', 'gap2'] },
      },
    } as any;

    // Handler may throw since initAgent failure is before try block — that's expected
    try {
      await handler(event, mockContext);
    } catch {
      // Expected: initAgent failure propagates since it's before the try block
    }

    // Gaps should NEVER have been transitioned to PROGRESS since
    // the transition now happens inside the try block (after initAgent)
    expect(mockMemory.updateGapStatus).not.toHaveBeenCalledWith('gap1', GapStatus.PROGRESS);
    expect(mockMemory.updateGapStatus).not.toHaveBeenCalledWith('gap2', GapStatus.PROGRESS);
  });
});
