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

// 2. Mock DynamoDB
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

// 3. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 4. Mock shared functions
const { mockGetRecursionLimit, mockHandleRecursionLimitExceeded, mockWakeupInitiator } = vi.hoisted(
  () => ({
    mockGetRecursionLimit: vi.fn().mockResolvedValue(50),
    mockHandleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
    mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock('./shared', () => ({
  getRecursionLimit: mockGetRecursionLimit,
  handleRecursionLimitExceeded: mockHandleRecursionLimitExceeded,
  wakeupInitiator: mockWakeupInitiator,
}));

// 5. Mock DynamicScheduler
const { mockScheduleOneShotTimeout } = vi.hoisted(() => ({
  mockScheduleOneShotTimeout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/scheduler', () => ({
  DynamicScheduler: {
    scheduleOneShotTimeout: mockScheduleOneShotTimeout,
  },
}));

// 6. Mock ConfigManager
const { mockGetRawConfig } = vi.hoisted(() => ({
  mockGetRawConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: mockGetRawConfig,
  },
}));

// 7. Mock trace helper
const { mockAddTraceStep } = vi.hoisted(() => ({
  mockAddTraceStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/trace-helper', () => ({
  addTraceStep: mockAddTraceStep,
}));

// 8. Mock schema
vi.mock('../../lib/schema/events', () => ({
  AGENT_PAYLOAD_SCHEMA: {
    parse: vi.fn().mockImplementation((data) => ({
      userId: data.userId ?? 'user-123',
      agentId: data.agentId ?? 'unknown',
      task: data.task ?? 'test task',
      traceId: data.traceId,
      initiatorId: data.initiatorId ?? 'orchestrator',
      depth: data.depth ?? 0,
      sessionId: data.sessionId,
      metadata: data.metadata ?? {},
    })),
  },
}));

// 9. Mock metadata utils
vi.mock('../../lib/utils/metadata', () => ({
  extractClarificationMetadata: vi.fn().mockReturnValue({
    question: undefined,
    originalTask: undefined,
    retryCount: undefined,
  }),
}));

// 10. Mock memory
const { mockSaveClarificationRequest } = vi.hoisted(() => ({
  mockSaveClarificationRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      saveClarificationRequest: mockSaveClarificationRequest,
    };
  }),
}));

// 11. Import code under test
import { handleClarificationRequest } from './clarification-handler';

describe('clarification-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecursionLimit.mockResolvedValue(50);
    mockGetRawConfig.mockResolvedValue(undefined);
  });

  const baseEventDetail = {
    userId: 'user-123',
    agentId: 'coder',
    task: 'Implement feature X',
    traceId: 'trace-abc',
    initiatorId: 'superclaw',
    depth: 1,
    sessionId: 'session-xyz',
    question: 'Which database should I use?',
    originalTask: 'Implement feature X',
  };

  describe('handleClarificationRequest', () => {
    it('processes clarification request and wakes up initiator', async () => {
      await handleClarificationRequest(baseEventDetail);

      expect(mockSaveClarificationRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'coder',
          initiatorId: 'superclaw',
          question: 'Which database should I use?',
          originalTask: 'Implement feature X',
          traceId: 'trace-abc',
          sessionId: 'session-xyz',
        })
      );

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('CLARIFICATION_REQUEST'),
        'trace-abc',
        'session-xyz',
        1
      );
    });

    it('schedules clarification timeout', async () => {
      await handleClarificationRequest(baseEventDetail);

      expect(mockScheduleOneShotTimeout).toHaveBeenCalledWith(
        expect.stringMatching(/^clarify-trace-abc-coder-\d+$/),
        expect.objectContaining({
          userId: 'user-123',
          agentId: 'coder',
          traceId: 'trace-abc',
        }),
        expect.any(Number),
        'clarification_timeout'
      );
    });

    it('uses configured timeout value', async () => {
      mockGetRawConfig.mockResolvedValue(600000);

      await handleClarificationRequest(baseEventDetail);

      const targetTime = mockScheduleOneShotTimeout.mock.calls[0][2];
      const now = Date.now();
      expect(targetTime).toBeGreaterThan(now + 590000);
      expect(targetTime).toBeLessThan(now + 610000);
    });

    it('handles recursion limit exceeded', async () => {
      mockGetRecursionLimit.mockResolvedValue(5);

      await handleClarificationRequest({ ...baseEventDetail, depth: 5 });

      expect(mockHandleRecursionLimitExceeded).toHaveBeenCalled();
      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });

    it('records trace steps for clarification request and agent waiting', async () => {
      await handleClarificationRequest(baseEventDetail);

      expect(mockAddTraceStep).toHaveBeenCalledWith(
        'trace-abc',
        'coder',
        expect.objectContaining({
          content: expect.objectContaining({
            question: 'Which database should I use?',
          }),
        })
      );
    });

    it('uses default question from task when question not provided', async () => {
      const detail = { ...baseEventDetail };
      delete (detail as any).question;

      await handleClarificationRequest(detail);

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('Implement feature X'),
        'trace-abc',
        'session-xyz',
        1
      );
    });

    it('generates safe traceId when not provided', async () => {
      const detail = { ...baseEventDetail };
      delete (detail as any).traceId;

      await handleClarificationRequest(detail);

      expect(mockSaveClarificationRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: expect.stringMatching(/^unknown-\d+$/),
        })
      );
    });
  });
});
