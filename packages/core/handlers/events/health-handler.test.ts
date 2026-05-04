import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 2. Mock shared function
const { mockProcessEventWithAgent } = vi.hoisted(() => ({
  mockProcessEventWithAgent: vi
    .fn()
    .mockResolvedValue({ responseText: 'Investigation complete', attachments: [] }),
}));

vi.mock('./shared', () => ({
  processEventWithAgent: mockProcessEventWithAgent,
}));

// 3. Mock schema
vi.mock('../../lib/schema/events', () => ({
  HEALTH_REPORT_EVENT_SCHEMA: {
    parse: vi.fn().mockImplementation((data) => ({
      userId: data.userId ?? 'user-123',
      component: data.component ?? 'api-gateway',
      issue: data.issue ?? 'High latency detected',
      severity: data.severity ?? 'critical',
      context: data.context ?? {},
      traceId: data.traceId,
      sessionId: data.sessionId,
    })),
  },
}));

// 4. Import code under test
import { handleHealthReport } from './health-handler';

describe('health-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'req-123',
    logGroupName: '/aws/lambda/test',
    logStreamName: '2026/03/28/[$LATEST]abc',
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };

  const baseEventDetail = {
    component: 'api-gateway',
    issue: 'High latency detected',
    severity: 'critical',
    context: { p99: 5000 },
    userId: 'user-123',
    traceId: 'trace-abc',
    sessionId: 'session-xyz',
  };

  describe('handleHealthReport', () => {
    it('processes health report with SUPERCLAW agent', async () => {
      await handleHealthReport(baseEventDetail, mockContext as any);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('SYSTEM HEALTH ALERT'),
        expect.objectContaining({
          context: mockContext,
          traceId: 'trace-abc',
          sessionId: 'session-xyz',
          handlerTitle: 'HEALTH_TRIAGE',
          outboundHandlerName: 'health-handler',
        })
      );
    });

    it('includes component and issue in the triage task', async () => {
      await handleHealthReport(baseEventDetail, mockContext as any);

      const taskArg = mockProcessEventWithAgent.mock.calls[0][2];
      expect(taskArg).toContain('api-gateway');
      expect(taskArg).toContain('High latency detected');
      expect(taskArg).toContain('CRITICAL');
    });

    it('includes context data in the triage task', async () => {
      await handleHealthReport(baseEventDetail, mockContext as any);

      const taskArg = mockProcessEventWithAgent.mock.calls[0][2];
      expect(taskArg).toContain('p99');
    });

    it('provides formatResponse that formats alert message', async () => {
      await handleHealthReport(baseEventDetail, mockContext as any);

      const options = mockProcessEventWithAgent.mock.calls[0][3];
      const formattedResponse = options.formatResponse('System recovered');

      expect(formattedResponse).toContain('SYSTEM HEALTH ALERT');
      expect(formattedResponse).toContain('api-gateway');
      expect(formattedResponse).toContain('High latency detected');
      expect(formattedResponse).toContain('System recovered');
    });

    it('handles missing context gracefully', async () => {
      const detail = { ...baseEventDetail };
      delete (detail as any).context;

      await handleHealthReport(detail, mockContext as any);

      expect(mockProcessEventWithAgent).toHaveBeenCalled();
    });
  });
});
