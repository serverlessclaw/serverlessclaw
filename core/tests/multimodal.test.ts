import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('../lib/tracer', () => ({
  ClawTracer: class {
    startTrace = vi.fn().mockResolvedValue('test-trace-id');
    endTrace = vi.fn().mockResolvedValue(undefined);
    addStep = vi.fn().mockResolvedValue(undefined);
    getTraceId = vi.fn().mockReturnValue('test-trace-id');
    getNodeId = vi.fn().mockReturnValue('test-node-id');
    getParentId = vi.fn().mockReturnValue(undefined);
  },
}));

import { Agent } from '../lib/agent';
import { MessageRole, AttachmentType, ReasoningProfile } from '../lib/types/llm';
import { AgentCategory } from '../lib/types';

describe('Multi-Modal Integration', () => {
  const mockMemory = {
    getHistory: vi.fn().mockResolvedValue([]),
    getDistilledMemory: vi.fn().mockResolvedValue(''),
    getLessons: vi.fn().mockResolvedValue([]),
    searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    getGlobalLessons: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue(undefined),
    getSummary: vi.fn().mockResolvedValue(null),
    setGap: vi.fn().mockResolvedValue(undefined),
    getFailedPlans: vi.fn().mockResolvedValue([]),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  };

  const mockProvider = {
    call: vi.fn(),
    getCapabilities: vi.fn().mockResolvedValue({
      contextWindow: 100000,
      supportedReasoningProfiles: [ReasoningProfile.STANDARD, ReasoningProfile.FAST],
    }),
  };

  const mockConfig = {
    id: 'test-agent',
    name: 'Test Agent',
    systemPrompt: 'You are a vision-capable agent.',
    enabled: true,
    description: 'test-agent',
    category: AgentCategory.SYSTEM,
    icon: 'test',
    tools: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass attachments to the provider for vision analysis', async () => {
    const agent = new Agent(
      mockMemory as any,
      mockProvider as any,
      [],
      mockConfig.systemPrompt,
      mockConfig
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'I see a cat in the image.',
      traceId: 'test-trace-id',
      messageId: 'test-msg-id',
    });

    const attachments = [
      {
        type: AttachmentType.IMAGE,
        name: 'cat.jpg',
        url: 'https://example.com/cat.jpg',
        base64: 'base64-data',
        mimeType: 'image/jpeg',
      },
    ];

    await agent.process('user-1', 'What is in this image?', {
      attachments,
    });

    // Verify that the provider was called with the attachments
    expect(mockProvider.call).toHaveBeenCalled();
    const lastCall = mockProvider.call.mock.calls[0];
    const messages = lastCall[0] as any[];

    const userMessage = messages.find((m) => m.role === MessageRole.USER && m.attachments);
    expect(userMessage).toBeDefined();
    expect(userMessage.attachments).toHaveLength(1);
    expect(userMessage.attachments[0].name).toBe('cat.jpg');
  });
});
