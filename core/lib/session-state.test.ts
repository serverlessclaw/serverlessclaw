import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SessionStateManager, PendingMessage } from './session-state';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

describe('SessionStateManager', () => {
  let sessionStateManager: SessionStateManager;

  beforeEach(() => {
    ddbMock.reset();
    sessionStateManager = new SessionStateManager();
  });

  describe('acquireProcessing', () => {
    it('should return true when no agent is processing', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-abc');

      expect(result).toBe(true);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should return false when another agent is processing', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-xyz');

      expect(result).toBe(false);
    });
  });

  describe('addPendingMessage', () => {
    it('should add a message to the pending queue', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-123', 'Hello world');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      expect((call.args[0].input as any).UpdateExpression).toContain('pendingMessages');
    });

    it('should include attachments when provided', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const attachments = [{ type: 'image' as const, base64: 'abc123' }];

      await sessionStateManager.addPendingMessage('session-123', 'Hello with image', attachments);

      expect(ddbMock.calls()).toHaveLength(1);
    });
  });

  describe('getPendingMessages', () => {
    it('should return empty array when no state exists', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should return pending messages when they exist', async () => {
      const pendingMessages: PendingMessage[] = [
        { id: 'msg-1', content: 'First', timestamp: 1000 },
        { id: 'msg-2', content: 'Second', timestamp: 2000 },
      ];
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages } });

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toEqual(pendingMessages);
    });
  });

  describe('removePendingMessage', () => {
    it('should return false when session does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await sessionStateManager.removePendingMessage('session-123', 'msg-1');

      expect(result).toBe(false);
    });

    it('should return true when message is removed successfully', async () => {
      const pendingMessages = [{ id: 'msg-1', content: 'First', timestamp: 1000 }];
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages } });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.removePendingMessage('session-123', 'msg-1');

      expect(result).toBe(true);
    });
  });

  describe('updatePendingMessage', () => {
    it('should return false when session does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await sessionStateManager.updatePendingMessage(
        'session-123',
        'msg-1',
        'Updated'
      );

      expect(result).toBe(false);
    });

    it('should return true when message is updated successfully', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { pendingMessages: [{ id: 'msg-1', content: 'Original', timestamp: 1000 }] },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.updatePendingMessage(
        'session-123',
        'msg-1',
        'Updated'
      );

      expect(result).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return null when no state exists', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await sessionStateManager.getState('session-123');

      expect(result).toBeNull();
    });

    it('should return full state when it exists', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sessionId: 'session-123',
          processingAgentId: 'agent-abc',
          processingStartedAt: 1000,
          pendingMessages: [{ id: 'msg-1', content: 'Test', timestamp: 2000 }],
          lastMessageAt: 2000,
        },
      });

      const result = await sessionStateManager.getState('session-123');

      expect(result).toEqual({
        sessionId: 'session-123',
        processingAgentId: 'agent-abc',
        processingStartedAt: 1000,
        pendingMessages: [{ id: 'msg-1', content: 'Test', timestamp: 2000 }],
        lastMessageAt: 2000,
      });
    });
  });

  describe('isProcessing', () => {
    it('should return false when no state exists', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await sessionStateManager.isProcessing('session-123');

      expect(result).toBe(false);
    });

    it('should return false when processing agent is null', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          processingAgentId: null,
          processingStartedAt: null,
          pendingMessages: [],
          lastMessageAt: Date.now(),
        },
      });

      const result = await sessionStateManager.isProcessing('session-123');

      expect(result).toBe(false);
    });
  });
});
