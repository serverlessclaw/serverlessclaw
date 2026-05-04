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
    debug: vi.fn(),
  },
}));

// 4. Mock bus
const { mockEmitEvent } = vi.hoisted(() => ({
  mockEmitEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: mockEmitEvent,
  EventPriority: { HIGH: 'HIGH', CRITICAL: 'CRITICAL', NORMAL: 'NORMAL' },
}));

// 5. Mock memory
const { mockGetClarificationRequest, mockUpdateClarificationStatus } = vi.hoisted(() => ({
  mockGetClarificationRequest: vi.fn().mockResolvedValue(null),
  mockUpdateClarificationStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      getClarificationRequest: mockGetClarificationRequest,
      updateClarificationStatus: mockUpdateClarificationStatus,
    };
  }),
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

// 7. Mock outbound
const { mockSendOutboundMessage } = vi.hoisted(() => ({
  mockSendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: mockSendOutboundMessage,
}));

// 8. Mock escalation manager
const { mockGetEscalationState, mockStartEscalation } = vi.hoisted(() => ({
  mockGetEscalationState: vi.fn().mockResolvedValue(null),
  mockStartEscalation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/lifecycle/escalation-manager', () => ({
  escalationManager: {
    getEscalationState: mockGetEscalationState,
    startEscalation: mockStartEscalation,
  },
}));

// 9. Import code under test
import { handleClarificationTimeout } from './clarification-timeout-handler';

describe('clarification-timeout-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawConfig.mockResolvedValue(undefined);
  });

  const baseEventDetail = {
    userId: 'user-123',
    agentId: 'coder',
    traceId: 'trace-abc',
    initiatorId: 'superclaw',
    originalTask: 'Implement feature X',
    question: 'Which database should I use?',
    sessionId: 'session-xyz',
    depth: 1,
    retryCount: 0,
  };

  describe('handleClarificationTimeout', () => {
    it('returns early when no clarification state found', async () => {
      mockGetClarificationRequest.mockResolvedValue(null);

      await handleClarificationTimeout(baseEventDetail);

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('returns early when clarification already answered', async () => {
      mockGetClarificationRequest.mockResolvedValue({
        status: 'answered',
      });

      await handleClarificationTimeout(baseEventDetail);

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('returns early when clarification already timed out', async () => {
      mockGetClarificationRequest.mockResolvedValue({
        status: 'timed_out',
      });

      await handleClarificationTimeout(baseEventDetail);

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('returns early when clarification already escalated', async () => {
      mockGetClarificationRequest.mockResolvedValue({
        status: 'escalated',
      });

      await handleClarificationTimeout(baseEventDetail);

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('starts escalation when escalation is enabled', async () => {
      mockGetRawConfig.mockResolvedValue(true);
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetEscalationState.mockResolvedValue(null);

      await handleClarificationTimeout(baseEventDetail);

      expect(mockStartEscalation).toHaveBeenCalledWith(
        'trace-abc',
        'coder',
        'user-123',
        'Which database should I use?',
        'Implement feature X',
        'session-xyz'
      );
    });

    it('skips escalation when already in progress', async () => {
      mockGetRawConfig.mockResolvedValue(true);
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetEscalationState.mockResolvedValue({ currentLevel: 1 });

      await handleClarificationTimeout(baseEventDetail);

      expect(mockStartEscalation).not.toHaveBeenCalled();
    });

    it('retries clarification when within max retries', async () => {
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetRawConfig.mockImplementation((key: string) => {
        if (key === 'escalation_enabled') return Promise.resolve(undefined);
        if (key === 'clarification_max_retries') return Promise.resolve(3);
        return Promise.resolve(undefined);
      });

      await handleClarificationTimeout(baseEventDetail);

      expect(mockUpdateClarificationStatus).toHaveBeenCalledWith('trace-abc', 'coder', 'pending');
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'clarification_request',
        expect.objectContaining({
          question: expect.stringContaining('RETRY 1/3'),
        }),
        expect.anything()
      );
    });

    it('performs strategic tie-break when retries exhausted', async () => {
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetRawConfig.mockImplementation((key: string) => {
        if (key === 'escalation_enabled') return Promise.resolve(undefined);
        if (key === 'clarification_max_retries') return Promise.resolve(1);
        return Promise.resolve(undefined);
      });

      await handleClarificationTimeout({ ...baseEventDetail, retryCount: 1 });

      expect(mockUpdateClarificationStatus).toHaveBeenCalledWith('trace-abc', 'coder', 'timed_out');

      // Should emit strategic tie-break
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'strategic_tie_break',
        expect.objectContaining({
          task: expect.stringContaining('STRATEGIC_TIE_BREAK'),
          originalTask: 'Implement feature X',
        }),
        expect.objectContaining({ priority: 'HIGH' })
      );

      // Should notify user via report-back
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'report_back',
        expect.objectContaining({
          action: expect.stringContaining('Strategic Tie-break'),
          agentId: 'superclaw',
        })
      );
    });

    it('falls back to legacy behavior when escalation fails', async () => {
      mockGetRawConfig.mockImplementation((key: string) => {
        if (key === 'escalation_enabled') return Promise.resolve(true);
        if (key === 'clarification_max_retries') return Promise.resolve(3);
        return Promise.resolve(undefined);
      });
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetEscalationState.mockRejectedValue(new Error('DB error'));

      await handleClarificationTimeout(baseEventDetail);

      // Should fall through to legacy retry
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'clarification_request',
        expect.objectContaining({
          question: expect.stringContaining('RETRY'),
        }),
        expect.anything()
      );
    });

    it('uses default max retries of 1 when not configured', async () => {
      mockGetClarificationRequest.mockResolvedValue({ status: 'pending' });
      mockGetRawConfig.mockResolvedValue(undefined);

      await handleClarificationTimeout({ ...baseEventDetail, retryCount: 1 });

      // retryCount 1 + 1 = 2 > default maxRetries 1 => should tie-break
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'strategic_tie_break',
        expect.anything(),
        expect.anything()
      );
    });
  });
});
