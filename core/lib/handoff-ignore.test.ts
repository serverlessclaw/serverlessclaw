import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole, ReasoningProfile, AttachmentType } from './types/index';
import * as handoff from './handoff';

vi.mock('./handoff', () => ({
  isHumanTakingControl: vi.fn(),
}));

vi.mock('./tracer', () => ({
  ClawTracer: vi.fn().mockImplementation(function () {
    return {
      getTraceId: () => 'test-trace',
      getNodeId: () => 'test-node',
      getParentId: () => 'test-parent',
      startTrace: vi.fn().mockResolvedValue(undefined),
      endTrace: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('./agent/assembler', () => ({
  AgentAssembler: {
    prepareContext: vi.fn().mockResolvedValue({
      contextPrompt: 'prompt',
      messages: [],
      summary: '',
      contextLimit: 1000,
      activeModel: 'model',
      activeProvider: 'provider',
    }),
  },
}));

vi.mock('./agent/executor', () => ({
  AgentExecutor: vi.fn().mockImplementation(function () {
    return {
      runLoop: vi.fn().mockResolvedValue({
        responseText: 'Agent response',
        paused: false,
      }),
    };
  }),
  AGENT_DEFAULTS: { MAX_ITERATIONS: 10 },
}));

describe('Agent Handoff Bypass', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      addMessage: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
      getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
    } as any;
    mockProvider = {
      call: vi.fn().mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'Agent response',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
    } as any;
  });

  it('should enter OBSERVE mode if handoff is active and ignoreHandoff is false', async () => {
    vi.mocked(handoff.isHumanTakingControl).mockResolvedValue(true);

    const agent = new Agent(mockMemory, mockProvider, [], 'system prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'system prompt',
      enabled: true,
    } as any);

    const result = await agent.process('user123', 'hello');

    expect(result.responseText).toBe('HUMAN_TAKING_CONTROL: Entering observe mode.');
    expect(mockProvider.call).not.toHaveBeenCalled();
  });

  it('should NOT enter OBSERVE mode if handoff is active but ignoreHandoff is true', async () => {
    vi.mocked(handoff.isHumanTakingControl).mockResolvedValue(true);

    const agent = new Agent(mockMemory, mockProvider, [], 'system prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'system prompt',
      enabled: true,
    } as any);

    const result = await agent.process('user123', 'hello', { ignoreHandoff: true });

    expect(result.responseText).toBe('Agent response');
  });

  it('should NOT enter OBSERVE mode if handoff is NOT active', async () => {
    vi.mocked(handoff.isHumanTakingControl).mockResolvedValue(false);

    const agent = new Agent(mockMemory, mockProvider, [], 'system prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'system prompt',
      enabled: true,
    } as any);

    const result = await agent.process('user123', 'hello');

    expect(result.responseText).toBe('Agent response');
  });
});
