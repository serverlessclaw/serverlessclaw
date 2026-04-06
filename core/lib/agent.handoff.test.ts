import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tracer-init module to return our fake tracer and export the
// internal mock functions for assertions. Keep mocks created inside the
// factory (no external top-level variables) so vi.mock hoisting is safe.
vi.mock('./agent/tracer-init', () => {
  const endTrace = vi.fn().mockResolvedValue(undefined);
  const startTrace = vi.fn().mockResolvedValue(undefined);

  const tracer = {
    getNodeId: () => 'node-1',
    getParentId: () => undefined,
    getTraceId: () => 'trace-xyz',
    startTrace,
    endTrace,
  } as any;

  return {
    initializeTracer: async () => ({ tracer, traceId: 'trace-xyz', baseUserId: 'user-123' }),
    // Expose mocks so tests can assert on them
    __endTraceMock: endTrace,
    __startTraceMock: startTrace,
  };
});

// Mock the handoff check to simulate human control being active
vi.mock('./handoff', () => ({
  isHumanTakingControl: async (_: string) => true,
}));

import { Agent } from './agent';

describe('Agent handoff (human control) branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('process returns human-control response and ends trace', async () => {
    const mockMemory: any = {
      addMessage: vi.fn().mockResolvedValue(undefined),
    };

    const mockProvider: any = {};

    const cfg = {
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'sys',
      enabled: true,
    } as any;

    const agent = new Agent(mockMemory, mockProvider, [], 'sys-prompt', cfg);

    const result = await agent.process('user-1', 'Hello', {});

    expect(result.responseText).toBe('HUMAN_TAKING_CONTROL: Entering observe mode.');
    expect(result.traceId).toBe('trace-xyz');
    // Access the exported mock from the mocked module
    const tracerInit: any = await import('./agent/tracer-init');
    expect(tracerInit.__endTraceMock).toHaveBeenCalledWith(
      'HUMAN_TAKING_CONTROL: Entering observe mode.'
    );
  });

  it('stream yields human-control chunk then ends trace', async () => {
    const mockMemory: any = {
      addMessage: vi.fn().mockResolvedValue(undefined),
    };

    const mockProvider: any = {};

    const cfg = {
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'sys',
      enabled: true,
    } as any;

    const agent = new Agent(mockMemory, mockProvider, [], 'sys-prompt', cfg);

    const gen = agent.stream('user-1', 'Hello', {});
    const first = await gen.next();

    expect(first.value).toBeDefined();
    expect(first.value.content).toBe('HUMAN_TAKING_CONTROL: Entering observe mode.');

    // Allow the generator to finish and ensure tracer endTrace was called
    const done = await gen.next();
    expect(done.done).toBe(true);
    const tracerInit: any = await import('./agent/tracer-init');
    expect(tracerInit.__endTraceMock).toHaveBeenCalled();
  });
});
