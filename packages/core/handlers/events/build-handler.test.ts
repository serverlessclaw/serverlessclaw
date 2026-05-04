import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleBuildFailure, handleBuildSuccess } from './build-handler';

// Mock dependencies
const mockWakeupInitiator = vi.fn();
const mockSendOutboundMessage = vi.fn();

vi.mock('./shared', () => ({
  wakeupInitiator: (...args: any[]) => mockWakeupInitiator(...args),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: (...args: any[]) => mockSendOutboundMessage(...args),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock DynamoDB
const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: (...args: any[]) => mockSend(...args),
    }),
  },
  PutCommand: class {},
  GetCommand: class {},
}));

describe('build-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('handleBuildFailure', () => {
    it('should notify user (via wakeupInitiator) on build failure', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed at step 2',
        traceId: 'trace-789',
        sessionId: 'session-101',
        initiatorId: 'superclaw',
        task: 'Implement feature X',
      };

      await handleBuildFailure(eventDetail, {} as any);

      // Verify wakeup
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('BUILD_FAILURE_NOTIFICATION'),
        'trace-789',
        'session-101',
        0,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should handle build failure without initiator', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        errorLogs: 'Build failed at step 2',
        traceId: 'trace-789',
        sessionId: 'session-101',
      };

      await handleBuildFailure(eventDetail, {} as any);

      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });
  });

  describe('handleBuildSuccess', () => {
    it('should notify user and wakeup initiator on build success', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-789',
        sessionId: 'session-101',
        initiatorId: 'superclaw',
        task: 'Implement feature X',
        traceId: 'trace-789',
      };

      await handleBuildSuccess(eventDetail);

      // Verify outbound message
      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-123',
        expect.stringContaining('DEPLOYMENT SUCCESSFUL'),
        undefined,
        'session-101',
        'SuperClaw',
        undefined,
        'trace-789',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      // Verify wakeup
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('BUILD_SUCCESS_NOTIFICATION'),
        'trace-789',
        'session-101',
        0,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should handle success without initiator', async () => {
      const eventDetail = {
        userId: 'user-123',
        buildId: 'build-456',
        sessionId: 'session-101',
        traceId: 'trace-789',
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
        traceId: 'trace-789',
      };

      await handleBuildSuccess(eventDetail);

      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-123',
        expect.stringContaining('Build ID: build-789'),
        undefined,
        'session-101',
        'SuperClaw',
        undefined,
        'trace-789',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });
  });
});
