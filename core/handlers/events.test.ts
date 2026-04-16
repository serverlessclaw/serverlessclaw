import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst' FIRST with a proxy
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    AgentTable: { name: 'test-agent-table' },
    SessionTable: { name: 'test-session-table' },
  },
}));

// Mock Agent
const mockProcess = vi.fn();
vi.mock('../lib/agent', () => {
  return {
    Agent: vi.fn(function () {
      return {
        process: mockProcess,
        stream: async function* () {
          // eslint-disable-next-line prefer-rest-params
          const result = await mockProcess.apply(this, arguments as any);
          yield { content: result.responseText };
        },
      };
    }),
  };
});

// Mock DistributedState
vi.mock('../lib/utils/distributed-state', () => ({
  DistributedState: {
    isCircuitOpen: vi.fn().mockResolvedValue(false),
    consumeToken: vi.fn().mockResolvedValue(true),
  },
}));

// Import local code AFTER the mocks
import { handler } from './events';
import { EventType } from '../lib/types/agent';

// Mock AgentRegistry
vi.mock('../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      systemPrompt: 'Test Prompt',
      name: 'SuperClaw',
    }),
    getRawConfig: vi.fn().mockResolvedValue(50),
  },
}));

// Mock ConfigManager
vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(async (_key, fallback) => fallback),
  },
}));

// Mock tools and outbound
vi.mock('../tools', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
  TOOLS: {},
}));

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => {
  return {
    EventBridgeClient: vi.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    PutEventsCommand: vi.fn().mockImplementation(function (args) {
      return { input: args };
    }),
  };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {
      config: { protocol: 'https' },
      send: vi.fn(),
    };
  }),
  PutItemCommand: vi.fn(),
  GetItemCommand: vi.fn(),
  ConditionalCheckFailedException: class extends Error {
    name = 'ConditionalCheckFailedException';
  },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// Mock recursion tracker
vi.mock('../lib/recursion-tracker', () => ({
  getRecursionDepth: vi.fn(async () => 0),
  incrementRecursionDepth: vi.fn(async () => 1),
  clearRecursionStack: vi.fn(async () => undefined),
  getRecursionLimit: vi.fn(async () => 15),
}));

// Mock logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock sub-handlers
vi.mock('./events/health-handler', () => ({
  handleHealthReport: vi.fn(),
}));
vi.mock('./events/build-handler', () => ({
  handleBuildFailure: vi.fn(),
  handleBuildSuccess: vi.fn(),
}));
vi.mock('./events/task-result-handler', () => ({
  handleTaskResult: vi.fn(),
}));
vi.mock('./events/continuation-handler', () => ({
  handleContinuationTask: vi.fn(),
}));
vi.mock('./events/clarification-handler', () => ({
  handleClarificationRequest: vi.fn(),
}));
vi.mock('./events/clarification-timeout-handler', () => ({
  handleClarificationTimeout: vi.fn(),
}));
vi.mock('./events/parallel-handler', () => ({
  handleParallelDispatch: vi.fn(),
}));

describe('EventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Routing', () => {
    it('should route SYSTEM_HEALTH_REPORT to health-handler', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { userId: 'u1', sessionId: 'test-session', traceId: 'test-trace' },
      };
      await handler(event as any, {} as any);
      const { handleHealthReport } = await import('./events/health-handler');
      expect(handleHealthReport).toHaveBeenCalled();
    });

    it('should route SYSTEM_BUILD_FAILED to build-handler', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_BUILD_FAILED,
        detail: { userId: 'u1', sessionId: 'test-session', traceId: 'test-trace' },
      };
      await handler(event as any, {} as any);
      const { handleBuildFailure } = await import('./events/build-handler');
      expect(handleBuildFailure).toHaveBeenCalled();
    });

    it('should route TASK_COMPLETED to task-result-handler', async () => {
      const event = {
        'detail-type': EventType.TASK_COMPLETED,
        detail: { userId: 'u1', sessionId: 'test-session', traceId: 'test-trace' },
      };
      await handler(event as any, {} as any);
      const { handleTaskResult } = await import('./events/task-result-handler');
      expect(handleTaskResult).toHaveBeenCalled();
    });

    it('should route CONTINUATION_TASK to continuation-handler', async () => {
      const event = {
        'detail-type': EventType.CONTINUATION_TASK,
        detail: { userId: 'u1', sessionId: 'test-session', traceId: 'test-trace' },
      };
      await handler(event as any, {} as any);
      const { handleContinuationTask } = await import('./events/continuation-handler');
      expect(handleContinuationTask).toHaveBeenCalled();
    });
  });

  describe('Safe Mode Fallback', () => {
    it('should block unrecognised routing combinations', async () => {
      const { ConfigManager } = await import('../lib/registry/config');
      await import('../lib/event-routing');

      // Mock a dangerous combination
      (ConfigManager.getTypedConfig as any).mockResolvedValue({
        [EventType.SYSTEM_HEALTH_REPORT]: {
          module: 'dangerous-module',
          function: 'formatDrive',
        },
      });

      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { userId: 'user-safe', sessionId: 'test-session', traceId: 'test-trace' },
      };

      await handler(event as any, {} as any);

      const { logger } = await import('../lib/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[SECURITY] Blocked unrecognised routing combination')
      );
    });
  });
});
