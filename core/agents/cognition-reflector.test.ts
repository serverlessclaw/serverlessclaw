import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './cognition-reflector';
import { MessageRole, GapStatus } from '../lib/types/index';

const mocks = vi.hoisted(() => ({
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  addLesson: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  agentProcess: vi.fn(),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    getDistilledMemory = vi.fn().mockResolvedValue('Old facts');
    getAllGaps = vi.fn().mockResolvedValue([]);
    updateDistilledMemory = mocks.updateDistilledMemory;
    addLesson = mocks.addLesson;
    setGap = mocks.setGap;
    updateGapStatus = mocks.updateGapStatus;
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {
    call = vi.fn();
  },
}));

vi.mock('../lib/agent', () => ({
  Agent: class {
    process = mocks.agentProcess;
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'cognition-reflector',
      name: 'Reflector',
      systemPrompt: 'Reflector Prompt',
      enabled: true,
    }),
  },
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/tracer', () => ({
  ClawTracer: {
    getTrace: vi.fn().mockResolvedValue([{ source: 'dashboard', steps: [] }]),
  },
}));

// Mock EventBridge
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutEventsCommand: class {
    constructor(public input: any) {}
  },
}));

describe('Cognition Reflector Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse reflection JSON and update memory', async () => {
    const mockReflectionResponse = JSON.stringify({
      facts: 'Updated facts including SuperPeng',
      lessons: [{ content: 'New lesson', impact: 8 }],
      gaps: [{ content: 'New gap', impact: 5, urgency: 5 }],
      resolvedGapIds: ['gap-123'],
    });

    mocks.agentProcess.mockResolvedValue(mockReflectionResponse);

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [
          { role: MessageRole.USER, content: 'Call me SuperPeng' },
          { role: MessageRole.ASSISTANT, content: 'Got it SuperPeng' },
        ],
        traceId: 'trace-456',
      },
    };

    await handler(event as any, {} as any);

    // Verify memory updates
    expect(mocks.updateDistilledMemory).toHaveBeenCalledWith(
      'user-123',
      'Updated facts including SuperPeng'
    );
    expect(mocks.addLesson).toHaveBeenCalledWith('user-123', 'New lesson', expect.any(Object));
    expect(mocks.setGap).toHaveBeenCalledWith(expect.any(String), 'New gap', expect.any(Object));
    expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-123', GapStatus.DONE);
  });

  it('should handle non-JSON responses gracefully', async () => {
    mocks.agentProcess.mockResolvedValue('I updated the facts for you.');

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [],
      },
    };

    const result = await handler(event as any, {} as any);
    expect(result).toBe('I updated the facts for you.');

    // Memory should NOT be updated with structured data
    expect(mocks.updateDistilledMemory).not.toHaveBeenCalled();
  });
});
