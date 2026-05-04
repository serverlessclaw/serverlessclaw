import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tracer functions
const { mockAddStep, mockStartTrace, mockEndTrace } = vi.hoisted(() => ({
  mockAddStep: vi.fn(),
  mockStartTrace: vi.fn().mockResolvedValue('test-trace-id'),
  mockEndTrace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./index', () => {
  const mockTracer = {
    getTraceId: () => 'test-trace-id',
    getNodeId: () => 'root',
    getParentId: () => undefined,
    startTrace: mockStartTrace,
    addStep: mockAddStep,
    endTrace: mockEndTrace,
    failTrace: vi.fn(),
    detectDrift: vi.fn(),
  };
  return {
    ClawTracer: vi.fn().mockImplementation(function () {
      return mockTracer;
    }),
  };
});

vi.mock('../agent/tracer-init', () => {
  const mockTracer = {
    getTraceId: () => 'test-trace-id',
    getNodeId: () => 'root',
    getParentId: () => undefined,
    startTrace: mockStartTrace,
    addStep: mockAddStep,
    endTrace: mockEndTrace,
    failTrace: vi.fn(),
    detectDrift: vi.fn(),
  };
  return {
    initializeTracer: vi.fn().mockResolvedValue({
      tracer: mockTracer,
      traceId: 'test-trace-id',
      baseUserId: 'user-1',
    }),
  };
});

vi.mock('../recursion-tracker', () => ({
  isBudgetExceeded: vi.fn().mockResolvedValue(false),
}));

vi.mock('../handoff', () => ({
  isHumanTakingControl: vi.fn().mockResolvedValue(false),
}));

import { Agent } from '../agent';
import { IMemory, IProvider, MessageRole, ReasoningProfile } from '../types/index';
import { TRACE_TYPES } from '../constants';

describe('Tracing Metadata Verification', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      getSummary: vi.fn().mockResolvedValue(null),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
      getScopedUserId: vi.fn().mockImplementation((u) => u),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'Response',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      stream: async function* () {
        yield { content: 'Streaming ' };
        yield { content: 'Response' };
        yield { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
      },
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
      }),
    } as unknown as IProvider;
  });

  it('should record model in both LLM_CALL and LLM_RESPONSE in standard loop', async () => {
    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'prompt',
      model: 'gpt-5-mini',
      provider: 'openai',
    });

    try {
      await agent.process('user-1', 'hello');
    } catch (e) {
      console.error('agent.process failed:', e);
      throw e;
    }

    // Verify LLM_CALL step
    console.log('mockAddStep calls:', mockAddStep.mock.calls.length);
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TRACE_TYPES.LLM_CALL,
        content: expect.objectContaining({
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      })
    );

    // Verify LLM_RESPONSE step
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: expect.objectContaining({
          model: 'gpt-5-mini',
          content: 'Response',
        }),
      })
    );
  });

  it('should record model in both LLM_CALL and LLM_RESPONSE in streaming loop', async () => {
    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'prompt',
      model: 'gpt-5-mini',
      provider: 'openai',
    });

    const stream = agent.stream('user-1', 'hello');
    for await (const _chunk of stream) {
      // consume stream
    }

    // Verify LLM_CALL step
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TRACE_TYPES.LLM_CALL,
        content: expect.objectContaining({
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      })
    );

    // Verify LLM_RESPONSE step
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: expect.objectContaining({
          model: 'gpt-5-mini',
          content: 'Streaming Response',
        }),
      })
    );
  });
});
