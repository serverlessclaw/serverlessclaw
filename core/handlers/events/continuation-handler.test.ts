import { vi, describe, it, expect, beforeEach } from 'vitest';

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
  },
}));

// 6. Mock Registry / Config
vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue('50'),
  },
}));

// 7. Mock shared functions
const { mockGetRecursionLimit, mockHandleRecursionLimitExceeded, mockProcessEventWithAgent } =
  vi.hoisted(() => ({
    mockGetRecursionLimit: vi.fn().mockResolvedValue(50),
    mockHandleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
    mockProcessEventWithAgent: vi
      .fn()
      .mockResolvedValue({ responseText: 'test-response', attachments: [] }),
  }));

vi.mock('./shared', () => ({
  getRecursionLimit: mockGetRecursionLimit,
  handleRecursionLimitExceeded: mockHandleRecursionLimitExceeded,
  processEventWithAgent: mockProcessEventWithAgent,
}));

// 8. Mock schema
vi.mock('../../lib/schema/events', () => ({
  TASK_EVENT_SCHEMA: {
    parse: vi.fn().mockImplementation((data) => ({
      userId: data.userId ?? 'user-123',
      agentId: data.agentId,
      task: data.task ?? 'test task',
      traceId: data.traceId,
      sessionId: data.sessionId,
      isContinuation: data.isContinuation,
      depth: data.depth ?? 1,
      initiatorId: data.initiatorId,
      attachments: data.attachments,
    })),
  },
}));

// 9. Import code to test
import { handleContinuationTask } from './continuation-handler';

describe('continuation-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecursionLimit.mockResolvedValue(50);
  });

  describe('handleContinuationTask', () => {
    it('should process continuation task with default agent when agentId not provided', async () => {
      const eventDetail = {
        userId: 'user-123',
        task: 'Continue working on feature',
        traceId: 'trace-456',
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Continue working on feature',
        expect.objectContaining({
          context: mockContext,
          isContinuation: true,
          traceId: 'trace-456',
          sessionId: 'session-789',
          handlerTitle: 'CONTINUATION_NOTIFICATION',
          outboundHandlerName: 'continuation-handler',
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

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        'Fix the bug',
        expect.anything()
      );
    });

    it('should handle recursion limit exceeded', async () => {
      mockGetRecursionLimit.mockResolvedValue(10);

      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        depth: 10,
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockHandleRecursionLimitExceeded).toHaveBeenCalledWith(
        'user-123',
        'session-789',
        'continuation-handler',
        expect.stringContaining('infinite loop in task continuation')
      );

      expect(mockProcessEventWithAgent).not.toHaveBeenCalled();
    });

    it('should process task when depth is below recursion limit', async () => {
      mockGetRecursionLimit.mockResolvedValue(50);

      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        depth: 5,
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockHandleRecursionLimitExceeded).not.toHaveBeenCalled();
      expect(mockProcessEventWithAgent).toHaveBeenCalled();
    });

    it('should default depth to 1 when not provided', async () => {
      const eventDetail = {
        userId: 'user-123',
        task: 'Continue task',
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      // Should process since 1 < 50 (default limit)
      expect(mockProcessEventWithAgent).toHaveBeenCalled();
    });

    it('should pass attachments to processEventWithAgent', async () => {
      const attachments = [{ type: 'image', url: 'https://example.com/image.png' }];

      const eventDetail = {
        userId: 'user-123',
        task: 'Analyze this image',
        attachments,
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

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
        initiatorId: 'planner',
        sessionId: 'session-789',
      };

      const mockContext = {} as any;

      await handleContinuationTask(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Continue task',
        expect.objectContaining({
          initiatorId: 'planner',
        })
      );
    });
  });
});
