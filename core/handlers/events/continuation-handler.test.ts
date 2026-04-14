import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleContinuationTask } from './continuation-handler';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => ({
        name: `test-${String(prop).toLowerCase()}`,
        value: 'test-value',
      }),
    }
  ),
}));

// 2. Mock AgentBus / EventBridge
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  PutEventsCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 3. Mock DynamoDB
const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(function () {
      return { send: mockDdbSend };
    }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  GetCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 4. Mock Outbound
vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// 5. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 6. Mock Registry / Config
vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue('50'),
  },
}));

// 7. Mock recursion tracker
const { mockGetRecursionLimit } = vi.hoisted(() => ({
  mockGetRecursionLimit: vi.fn().mockResolvedValue(50),
}));

vi.mock('../../lib/recursion-tracker', () => ({
  getRecursionLimit: mockGetRecursionLimit,
  incrementRecursionDepth: vi.fn().mockResolvedValue(1),
  getRecursionDepth: vi.fn().mockResolvedValue(0),
}));

// 8. Mock shared functions
const { mockHandleRecursionLimitExceeded, mockProcessEventWithAgent, mockCheckAndPushRecursion } =
  vi.hoisted(() => ({
    mockHandleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
    mockProcessEventWithAgent: vi
      .fn()
      .mockResolvedValue({ responseText: 'test-response', attachments: [] }),
    mockCheckAndPushRecursion: vi.fn().mockResolvedValue(1),
  }));

vi.mock('./shared', () => ({
  handleRecursionLimitExceeded: mockHandleRecursionLimitExceeded,
  processEventWithAgent: mockProcessEventWithAgent,
  checkAndPushRecursion: mockCheckAndPushRecursion,
  isMissionContext: vi.fn().mockReturnValue(false),
}));

// 9. Mock schema
vi.mock('../../lib/schema/events', () => ({
  TASK_EVENT_SCHEMA: {
    parse: vi.fn().mockImplementation((data) => ({
      userId: data.userId ?? 'user-123',
      agentId: data.agentId,
      task: data.task,
      traceId: data.traceId ?? 'trace-456',
      sessionId: data.sessionId,
      depth: data.depth ?? 0,
      isContinuation: data.isContinuation ?? false,
      initiatorId: data.initiatorId,
      attachments: data.attachments,
    })),
  },
}));

describe('continuation-handler', () => {
  const mockContext: any = { awsRequestId: 'request-123' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecursionLimit.mockResolvedValue(50);
    mockCheckAndPushRecursion.mockResolvedValue(1);
  });

  describe('handleContinuationTask', () => {
    it('should successfully handle a basic continuation task', async () => {
      const eventDetail = {
        userId: 'user-123',
        task: 'Continue doing the thing',
        traceId: 'trace-456',
        sessionId: 'session-789',
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Continue doing the thing',
        expect.objectContaining({
          traceId: 'trace-456',
          sessionId: 'session-789',
          isContinuation: true,
        })
      );
    });

    it('should use provided agentId when specified', async () => {
      const eventDetail = {
        userId: 'user-123',
        agentId: 'coder',
        task: 'Fix the bug',
        sessionId: 'session-789',
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        'Fix the bug',
        expect.anything()
      );
    });

    it('should handle recursion limit exceeded', async () => {
      mockGetRecursionLimit.mockResolvedValue(9);
      mockCheckAndPushRecursion.mockResolvedValue(null);

      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        depth: 10,
        sessionId: 'session-789',
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockHandleRecursionLimitExceeded).toHaveBeenCalledWith(
        'user-123',
        'session-789',
        'continuation-handler',
        expect.stringContaining('infinite loop in task continuation'),
        'trace-456',
        'superclaw'
      );
      expect(mockProcessEventWithAgent).not.toHaveBeenCalled();
    });

    it('should process task when depth is below recursion limit', async () => {
      mockGetRecursionLimit.mockResolvedValue(50);
      mockCheckAndPushRecursion.mockResolvedValue(5);

      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        depth: 4,
        sessionId: 'session-789',
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalled();
      expect(mockHandleRecursionLimitExceeded).not.toHaveBeenCalled();
    });

    it('should pass attachments to processEventWithAgent', async () => {
      const attachments = [{ url: 'http://example.com/image.png' }];
      const eventDetail = {
        userId: 'user-123',
        task: 'Analyze this image',
        attachments,
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Analyze this image',
        expect.objectContaining({
          attachments,
        })
      );
    });

    it('should pass initiatorId to processEventWithAgent', async () => {
      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        initiatorId: 'strategic-planner',
        sessionId: 'session-789',
      };

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Continue task',
        expect.objectContaining({
          initiatorId: 'strategic-planner',
        })
      );
    });
  });
});
