import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pauseWorkflow, resumeWorkflow } from './workflow';
import { SessionStateManager } from '../../lib/session/session-state';
import { CachedMemory } from '../../lib/memory/cached-memory';
import { DynamoMemory } from '../../lib/memory/dynamo-memory';

// Mock dependencies
vi.mock('../../lib/memory/dynamo-memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function (this: any) {
    // Default: no properties needed
  }),
}));

vi.mock('../../lib/memory/cached-memory', () => ({
  CachedMemory: vi.fn().mockImplementation(function (this: any, _inner: any) {
    this.getHistory = vi.fn();
  }),
}));

vi.mock('../../lib/session/session-state', () => ({
  SessionStateManager: vi.fn().mockImplementation(function (this: any) {
    this.saveSnapshot = vi.fn();
    this.clearSnapshot = vi.fn();
    this.getState = vi.fn();
  }),
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: (e: Error) => e.message,
}));

describe('pauseWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pause workflow and save snapshot', async () => {
    const args = {
      sessionId: 'session-123',
      executorAgentId: 'agent-coder',
      originalUserTask: 'Implement feature X',
      userId: 'user-456',
      reason: 'Waiting for approvals',
      metadata: { priority: 'high' },
    };

    const mockHistory = [{ role: 'user', content: 'test' }];

    // Override CachedMemory mock to return a getHistory that resolves to mockHistory
    (CachedMemory as any).mockImplementation(function (this: any, _inner: any) {
      this.getHistory = vi.fn().mockResolvedValue(mockHistory);
    });

    // DynamoMemory doesn't need to do anything; just be constructable
    (DynamoMemory as any).mockImplementation(function (this: any) {});

    const result = await pauseWorkflow.execute(args as any);

    expect(result).toContain('TASK_PAUSED');
    expect(result).toContain('session-123');
    expect(SessionStateManager).toHaveBeenCalled();

    const instance = (SessionStateManager as any).mock.instances[0];
    expect(instance.saveSnapshot).toHaveBeenCalledWith('session-123', {
      reason: args.reason,
      timestamp: expect.any(Number),
      agentId: args.executorAgentId,
      task: args.originalUserTask,
      state: { historyCount: mockHistory.length },
      metadata: {
        priority: 'high',
        userId: args.userId,
        storageId: args.userId,
      },
    });
  });

  it('should return FAILED when sessionId is missing', async () => {
    const args = {
      sessionId: '',
      executorAgentId: 'agent-1',
      originalUserTask: 'test',
      userId: 'user-1',
      reason: 'test',
    };

    const result = await pauseWorkflow.execute(args as any);
    expect(result).toContain('FAILED');
  });
});

describe('resumeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resume workflow from snapshot', async () => {
    const snapshot = {
      reason: 'paused',
      timestamp: 1700000000000,
      agentId: 'agent-coder',
      task: 'Implement feature X',
      metadata: { userId: 'user-456' },
    };

    const mockState = {
      workflowSnapshot: snapshot,
    };

    // Override SessionStateManager to provide specific getState behavior
    (SessionStateManager as any).mockImplementation(function (this: any) {
      this.getState = vi.fn().mockResolvedValue(mockState);
      this.clearSnapshot = vi.fn().mockResolvedValue(undefined);
    });

    const args = {
      sessionId: 'session-123',
    };

    const result = await resumeWorkflow.execute(args as any);

    expect(result).toContain('SUCCESS');
    expect(result).toContain('session-123');
    expect(result).toContain('agent-coder');

    const instance = (SessionStateManager as any).mock.instances[0];
    expect(instance.getState).toHaveBeenCalledWith('session-123');
    expect(instance.clearSnapshot).toHaveBeenCalledWith('session-123');
  });

  it('should fail when no snapshot found', async () => {
    const mockState = {
      workflowSnapshot: null,
    };

    (SessionStateManager as any).mockImplementation(function (this: any) {
      this.getState = vi.fn().mockResolvedValue(mockState);
    });

    const result = await resumeWorkflow.execute({ sessionId: 'session-123' } as any);
    expect(result).toContain('FAILED');
    expect(result).toContain('No active snapshot');
  });

  it('should fail when sessionId is missing', async () => {
    const result = await resumeWorkflow.execute({} as any);
    expect(result).toContain('FAILED');
    expect(result).toContain('No session ID');
  });
});
