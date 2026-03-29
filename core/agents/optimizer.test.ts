import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './optimizer';
import { AgentType } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';

// Mock dependencies
vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event) => event.detail || event),
  initAgent: vi.fn().mockResolvedValue({
    config: {
      id: 'optimizer',
      name: 'Swarm Optimizer',
      systemPrompt: 'Audit swarm efficiency.',
      enabled: true,
    },
    memory: {
      getFailedPlans: vi.fn().mockResolvedValue([]),
      getFailurePatterns: vi.fn().mockResolvedValue([]),
      setGap: vi.fn().mockResolvedValue(undefined),
      recordFailurePattern: vi.fn().mockResolvedValue(undefined),
    },
    provider: {},
    agent: {
      process: vi.fn().mockResolvedValue({
        responseText: JSON.stringify({
          status: 'SUCCESS',
          optimizations: [
            {
              type: 'MODEL_SWAP',
              agentId: 'qa',
              reason: 'Low complexity tasks.',
            },
          ],
          antiPatterns: ['recursive-loop-failure'],
        }),
        attachments: [],
      }),
    },
  }),
}));

vi.mock('../lib/token-usage', () => ({
  TokenTracker: {
    getRollupRange: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAllConfigs: vi.fn().mockResolvedValue({
      'agent-1': { id: 'agent-1' },
    }),
  },
}));

describe('Optimizer Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should perform an efficiency audit and record improvements', async () => {
    const event = {
      detail: {
        userId: 'user-1',
        task: 'Weekly audit',
        traceId: 'trace-123',
      },
    };

    await handler(event as any, {} as any);

    const { initAgent } = await import('../lib/utils/agent-helpers');
    const { memory } = await initAgent(AgentType.OPTIMIZER);

    expect(memory.setGap).toHaveBeenCalledWith(
      expect.stringMatching(/^OPT-/),
      expect.stringContaining('[SYSTEM_IMPROVEMENT]'),
      expect.objectContaining({
        category: InsightCategory.SYSTEM_IMPROVEMENT,
      })
    );

    expect(memory.recordFailurePattern).toHaveBeenCalledWith(
      'SYSTEM#GLOBAL',
      expect.stringContaining('[ANTI-PATTERN]'),
      expect.any(Object)
    );
  });
});
