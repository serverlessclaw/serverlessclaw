import { describe, it, expect, vi } from 'vitest';
import {
  createMockRunLoop,
  createMockAgentExecutorFactory,
  createMockClawTracer,
} from './mock-agent-executor';

describe('mock-agent-executor helpers', () => {
  it('createMockRunLoop should call provider and handle messages', async () => {
    const mockProvider = {
      call: vi.fn().mockResolvedValue({ content: 'response' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
      }),
    };
    const runLoop = createMockRunLoop(mockProvider as any, {}, 'agent-1', 'Agent 1');
    const response = await runLoop([]);
    expect(response.content).toBe('response');
    expect(mockProvider.call).toHaveBeenCalled();
  });

  it('createMockRunLoop should handle tool calls', async () => {
    const mockProvider = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          role: 'assistant',
          tool_calls: [{ id: '1', function: { name: 'test_tool' } }],
        })
        .mockResolvedValueOnce({ content: 'final response' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
      }),
    };
    const runLoop = createMockRunLoop(mockProvider as any, {}, 'agent-1', 'Agent 1');
    const response = await runLoop([
      { role: 'assistant', tool_calls: [{ id: '1', function: { name: 'test_tool' } }] },
    ]);
    expect(response.content).toBe('final response');
    expect(mockProvider.call).toHaveBeenCalledTimes(2);
  });

  it('createMockAgentExecutorFactory should create factory object', () => {
    const mockProvider = {
      call: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
      }),
    };
    const factory = createMockAgentExecutorFactory(mockProvider as any, {}, 'agent-1', 'Agent 1');
    expect(factory.agentId).toBe('agent-1');
    expect(factory.runLoop).toBeDefined();
  });

  it('createMockClawTracer should create tracer with defaults', () => {
    const tracer = createMockClawTracer();
    expect(tracer.startTrace).toBeDefined();
    expect(tracer.getTraceId()).toBeUndefined();
  });
});
