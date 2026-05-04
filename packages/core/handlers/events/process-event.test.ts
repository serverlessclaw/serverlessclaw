import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processEventWithAgent } from './shared';
import { Agent } from '../../lib/agent';

vi.mock('../../lib/session/session-state', () => ({
  SessionStateManager: vi.fn().mockImplementation(function () {
    return {
      acquireProcessing: vi.fn().mockResolvedValue(true),
      releaseProcessing: vi.fn().mockResolvedValue(true),
    };
  }),
}));

vi.mock('../../lib/lock/lock-manager', () => ({
  LockManager: vi.fn().mockImplementation(function () {
    return {
      acquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
  }),
}));

vi.mock('../../lib/agent', () => {
  return {
    Agent: vi.fn().mockImplementation(function () {
      return {
        stream: vi.fn().mockReturnValue(
          (async function* () {
            yield { type: 'text', text: 'hello' };
          })()
        ),
      };
    }),
  };
});

vi.mock('../../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Agent 1' }),
  },
}));

vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn().mockResolvedValue({ memory: {}, provider: {} }),
  isTaskPaused: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('processEventWithAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should enforce json communication mode when initiatorId is provided', async () => {
    const userId = 'user-1';
    const agentId = 'agent-1';
    const task = 'do something';
    const options = {
      initiatorId: 'initiator-agent',
      traceId: 'trace-1',
      sessionId: 'sess-1',
      handlerTitle: 'TEST',
    };

    await processEventWithAgent(userId, agentId, task, options as any);

    const agentInstance = vi.mocked(Agent).mock.results[0].value;
    expect(agentInstance.stream).toHaveBeenCalledWith(
      userId,
      expect.stringContaining(task),
      expect.objectContaining({
        communicationMode: 'json',
      })
    );
  });

  it('should use text communication mode when initiatorId is missing', async () => {
    const userId = 'user-1';
    const agentId = 'agent-1';
    const task = 'do something';
    const options = {
      traceId: 'trace-1',
      sessionId: 'sess-1',
      handlerTitle: 'TEST',
    };

    await processEventWithAgent(userId, agentId, task, options as any);

    const agentInstance = vi.mocked(Agent).mock.results[0].value;
    expect(agentInstance.stream).toHaveBeenCalledWith(
      userId,
      expect.stringContaining(task),
      expect.objectContaining({
        communicationMode: 'text',
      })
    );
  });
});
