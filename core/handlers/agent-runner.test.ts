import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './agent-runner';
import { EventType } from '../lib/types/agent';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import {
  validatePayload,
  isTaskPaused,
  detectFailure,
  initAgent,
} from '../lib/utils/agent-helpers';

const mockAgent = {
  process: vi.fn(),
  stream: vi.fn(),
};

const mockConfig = {
  category: 'social',
  defaultCommunicationMode: 'text' as const,
};

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((x) => x),
  extractBaseUserId: vi.fn((x) => x),
  detectFailure: vi.fn(() => false),
  isTaskPaused: vi.fn(() => false),
  validatePayload: vi.fn(() => true),
  buildProcessOptions: vi.fn((x) => ({ ...x })),
  initAgent: vi.fn(async () => ({
    config: mockConfig,
    agent: mockAgent,
  })),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn(),
}));

vi.mock('../lib/session/session-state', () => ({
  SessionStateManager: vi.fn().mockImplementation(function () {
    return {
      acquireProcessing: vi.fn().mockResolvedValue(true),
      renewProcessing: vi.fn().mockResolvedValue(true),
      releaseProcessing: vi.fn().mockResolvedValue(true),
      addPendingMessage: vi.fn().mockResolvedValue(true),
      getState: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock('../lib/recursion-tracker', () => ({
  incrementRecursionDepth: vi.fn(async () => 1),
  getRecursionDepth: vi.fn(async () => 0),
  clearRecursionStack: vi.fn(async () => undefined),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
  },
}));

describe('AgentRunner Handler', () => {
  const fakeContext = { awsRequestId: 'request-123' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent.process.mockResolvedValue({
      responseText: 'Processed response',
      attachments: [],
    });
    mockAgent.stream.mockImplementation(async function* () {
      yield { content: 'Streamed ' };
      yield { content: 'response' };
    });
  });

  it('skips system events', async () => {
    const event = {
      'detail-type': EventType.TASK_COMPLETED,
      detail: {},
    } as any;

    const result = await handler(event, fakeContext);

    expect(result).toBeUndefined();
    expect(mockAgent.process).not.toHaveBeenCalled();
  });

  it('initializes agent and processes task with streaming when shouldSpeakDirectly is true', async () => {
    const event = {
      'detail-type': 'dynamic_myagent_task',
      detail: {
        userId: 'user-1',
        task: 'Hello',
        traceId: 'trace-1',
        taskId: 'task-1',
        sessionId: 'session-1',
      },
    } as any;

    const result = await handler(event, fakeContext);

    expect(result).toBe('Streamed response');
    expect(mockAgent.stream).toHaveBeenCalled();
    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'myagent',
        response: 'Streamed response',
        userNotified: true,
      })
    );
  });

  it('processes task without streaming when shouldSpeakDirectly is false', async () => {
    vi.mocked(initAgent).mockResolvedValueOnce({
      config: { ...mockConfig, category: 'utility', defaultCommunicationMode: 'json' } as any,
      agent: mockAgent as any,
      memory: {} as any,
      provider: {} as any,
    });

    const event = {
      'detail-type': 'dynamic_myagent_task',
      detail: {
        userId: 'user-1',
        task: 'Hello',
      },
    } as any;

    const result = await handler(event, fakeContext);

    expect(result).toBe('Processed response');
    expect(mockAgent.process).toHaveBeenCalled();
    expect(mockAgent.stream).not.toHaveBeenCalled();
    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        response: 'Processed response',
        userNotified: false,
      })
    );
  });

  it('returns early if payload is invalid', async () => {
    vi.mocked(validatePayload).mockReturnValueOnce(false);

    const event = {
      'detail-type': 'dynamic_myagent_task',
      detail: { userId: 'user-1' }, // missing task
    } as any;

    const result = await handler(event, fakeContext);

    expect(result).toBeUndefined();
    expect(mockAgent.process).not.toHaveBeenCalled();
  });

  it('handles task paused state', async () => {
    vi.mocked(isTaskPaused).mockReturnValueOnce(true);

    const event = {
      'detail-type': 'dynamic_myagent_task',
      detail: { userId: 'user-1', task: 'Hello' },
    } as any;

    await handler(event, fakeContext);

    expect(emitTaskEvent).not.toHaveBeenCalled();
  });

  it('detects failure and emits task event with error', async () => {
    vi.mocked(detectFailure).mockReturnValueOnce(true);

    const event = {
      'detail-type': 'dynamic_myagent_task',
      detail: { userId: 'user-1', task: 'Hello' },
    } as any;

    await handler(event, fakeContext);

    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Streamed response',
      })
    );
  });
});
