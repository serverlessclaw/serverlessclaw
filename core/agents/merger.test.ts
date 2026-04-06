import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './merger';
import { AgentType, EventType } from '../lib/types/agent';
import { AGENT_ERRORS } from '../lib/constants';
import { initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

// Mock dependencies
vi.mock('../lib/utils/agent-helpers', () => ({
  initAgent: vi.fn(),
  extractPayload: vi.fn((e) => e.detail),
  validatePayload: vi.fn(() => true),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn(),
}));

vi.mock('../tools/infra/deployment', () => ({
  triggerDeployment: {
    execute: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../handlers/events/merger-handler', () => ({
  extractPatch: vi.fn((res) => (res && typeof res === 'object' ? (res as any).patch : undefined)),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Merger Agent Handler', () => {
  const mockAgent = {
    process: vi.fn().mockResolvedValue({
      responseText: JSON.stringify({ status: 'SUCCESS', response: 'Merged successfully' }),
      attachments: [],
    }),
  };

  const mockMemory = {};
  const mockConfig = { id: AgentType.MERGER, name: 'Structural Merger' };

  beforeEach(() => {
    vi.clearAllMocks();
    (initAgent as any).mockResolvedValue({
      agent: mockAgent,
      memory: mockMemory,
      config: mockConfig,
    });
  });

  it('should process parallel patches and emit a completion event', async () => {
    const event = {
      'detail-type': EventType.PARALLEL_TASK_COMPLETED,
      detail: {
        userId: 'user-1',
        task: 'Implement authentication',
        traceId: 'trace-1',
        sessionId: 'session-1',
        initiatorId: 'planner-1',
        depth: 1,
        metadata: {
          patches: [
            { coderId: 'coder-1', patch: 'diff-1' },
            { coderId: 'coder-2', patch: 'diff-2' },
          ],
        },
      },
    };

    const result = await handler(event as any, {} as any);

    expect(initAgent).toHaveBeenCalledWith(AgentType.MERGER);
    expect(mockAgent.process).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('Reconcile the following code patches'),
      expect.objectContaining({
        traceId: 'trace-1',
        sessionId: 'session-1',
      })
    );

    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: AgentType.MERGER,
        agentId: AgentType.MERGER,
        response: expect.stringContaining('Merged successfully'),
      })
    );

    expect(result).toContain('Merged successfully');
  });

  it('should fail fast when patch payload is too large', async () => {
    const hugePatch = 'x'.repeat(120 * 1024);
    const event = {
      'detail-type': EventType.PARALLEL_TASK_COMPLETED,
      detail: {
        userId: 'user-1',
        task: 'Merge large patch set',
        traceId: 'trace-large',
        sessionId: 'session-large',
        initiatorId: 'planner-1',
        depth: 1,
        metadata: {
          patches: [{ coderId: 'coder-1', patch: hugePatch }],
        },
      },
    };

    const result = await handler(event as any, {} as any);

    expect(mockAgent.process).not.toHaveBeenCalled();
    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.MERGER,
        response: expect.stringContaining('FAILED: Patch payload too large for LLM reconciliation'),
      })
    );
    expect(result).toContain('FAILED: Patch payload too large for LLM reconciliation');
  });

  it('should extract patches from results array if patches metadata is missing', async () => {
    const event = {
      'detail-type': EventType.PARALLEL_TASK_COMPLETED,
      detail: {
        userId: 'user-1',
        task: 'Merge from results',
        metadata: {
          results: [
            { agentId: 'coder-1', result: { patch: 'extracted-patch-1' } },
            { agentId: 'coder-2', patch: 'direct-patch-2' },
          ],
        },
      },
    };

    await handler(event as any, {} as any);

    expect(mockAgent.process).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('extracted-patch-1'),
      expect.anything()
    );
    expect(mockAgent.process).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('direct-patch-2'),
      expect.anything()
    );
  });

  it('should trigger deployment when response includes PATCH_START', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: 'Here is the patch: PATCH_START\n...\nPATCH_END',
      attachments: [],
    });

    const { triggerDeployment } = await import('../tools/infra/deployment');

    await handler(
      {
        detail: { userId: 'u1', task: 't1', metadata: { patches: [] } },
      } as any,
      {} as any
    );

    expect(triggerDeployment.execute).toHaveBeenCalled();
  });

  it('should gracefully handle deployment trigger failure', async () => {
    mockAgent.process.mockResolvedValueOnce({
      responseText: 'PATCH_START\n...',
      attachments: [],
    });

    const { triggerDeployment } = await import('../tools/infra/deployment');
    (triggerDeployment.execute as any).mockRejectedValueOnce(new Error('Deploy fail'));

    // Should not throw
    await expect(
      handler(
        {
          detail: { userId: 'u1', task: 't1', metadata: { patches: [] } },
        } as any,
        {} as any
      )
    ).resolves.toBeDefined();
  });

  it('should handle process failure and emit error event', async () => {
    mockAgent.process.mockRejectedValueOnce(new Error('Process crash'));

    const result = await handler(
      {
        detail: { userId: 'u1', task: 't1', metadata: { patches: [] } },
      } as any,
      {} as any
    );

    expect(result).toBe(AGENT_ERRORS.PROCESS_FAILURE);
    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Process crash',
      })
    );
  });
});
