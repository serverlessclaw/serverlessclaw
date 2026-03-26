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
const { mockSendOutboundMessage } = vi.hoisted(() => ({
  mockSendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: mockSendOutboundMessage,
}));

// 5. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 6. Mock shared functions
const { mockWakeupInitiator, mockProcessEventWithAgent } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
  mockProcessEventWithAgent: vi
    .fn()
    .mockResolvedValue({ responseText: 'test-response', attachments: [] }),
}));

vi.mock('./shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
  processEventWithAgent: mockProcessEventWithAgent,
}));

// 7. Mock schema
vi.mock('../../lib/schema/events', () => ({
  BUILD_EVENT_SCHEMA: {
    parse: vi.fn().mockImplementation((data) => data),
  },
}));

// 8. Import code to test
import { handleBuildFailure, handleBuildSuccess } from './build-handler';

describe('build-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleBuildFailure', () => {
    it('should process build failure event with all required fields', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed: compilation error',
        traceId: 'trace-789',
        gapIds: ['gap-1', 'gap-2'],
        sessionId: 'session-101',
        initiatorId: 'superclaw',
        task: 'Deploy feature',
      };

      const mockContext = {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '128',
        awsRequestId: 'request-123',
        logGroupName: '/aws/lambda/test-function',
        logStreamName: '2024/01/01/[$LATEST]abc123',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn(),
      } as any;

      await handleBuildFailure(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        expect.stringContaining('CRITICAL: Deployment build-456 failed'),
        expect.objectContaining({
          context: mockContext,
          traceId: 'trace-789',
          sessionId: 'session-101',
          handlerTitle: 'SYSTEM_NOTIFICATION',
          outboundHandlerName: 'build-handler',
        })
      );

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('BUILD_FAILURE_NOTIFICATION'),
        'trace-789',
        'session-101'
      );
    });

    it('should handle build failure without initiator', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed',
        traceId: 'trace-789',
        sessionId: 'session-101',
      };

      const mockContext = {} as any;

      await handleBuildFailure(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalled();
      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });

    it('should include gap context in task message when gapIds provided', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed',
        gapIds: ['gap-1', 'gap-2'],
        sessionId: 'session-101',
      };

      const mockContext = {} as any;

      await handleBuildFailure(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        expect.stringContaining('This deployment was addressing the following gaps: gap-1, gap-2'),
        expect.anything()
      );
    });

    it('should include trace context in task message when traceId provided', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed',
        traceId: 'trace-789',
        sessionId: 'session-101',
      };

      const mockContext = {} as any;

      await handleBuildFailure(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        expect.stringContaining('Refer to the previous reasoning trace for context: trace-789'),
        expect.anything()
      );
    });

    it('should include error logs in task message', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Error: Cannot find module',
        sessionId: 'session-101',
      };

      const mockContext = {} as any;

      await handleBuildFailure(eventDetail, mockContext);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'coder',
        expect.stringContaining('Error: Cannot find module'),
        expect.anything()
      );
    });
  });

  describe('handleBuildSuccess', () => {
    it('should send success message and wake up initiator', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        sessionId: 'session-101',
        initiatorId: 'superclaw',
        task: 'Deploy feature',
        traceId: 'trace-789',
      };

      await handleBuildSuccess(eventDetail);

      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-123',
        expect.stringContaining('DEPLOYMENT SUCCESSFUL'),
        undefined,
        'session-101',
        'SuperClaw',
        undefined
      );

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('BUILD_SUCCESS_NOTIFICATION'),
        'trace-789',
        'session-101'
      );
    });

    it('should handle success without initiator', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        sessionId: 'session-101',
      };

      await handleBuildSuccess(eventDetail);

      expect(mockSendOutboundMessage).toHaveBeenCalled();
      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });

    it('should include build ID in success message', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-789',
        sessionId: 'session-101',
      };

      await handleBuildSuccess(eventDetail);

      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-123',
        expect.stringContaining('Build ID: build-789'),
        undefined,
        'session-101',
        'SuperClaw',
        undefined
      );
    });

    it('should include QA verification note in success message', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        sessionId: 'session-101',
      };

      await handleBuildSuccess(eventDetail);

      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-123',
        expect.stringContaining('QA Auditor will verify'),
        undefined,
        'session-101',
        'SuperClaw',
        undefined
      );
    });
  });
});
