import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  PutCommandInput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { SessionStateManager } from './session-state';

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
      const call = ddbMock.call(0);
      const item = (call.args[0].input as PutCommandInput).Item;
      expect(item?.processingAgentId).toBe('agent-abc');
      expect(item?.lockExpiresAt).toBeDefined();
      expect(item?.expiresAt).toBeDefined();
      // Ensure lockExpiresAt is smaller than expiresAt (300s vs 30 days)
      expect(item?.lockExpiresAt).toBeLessThan(item?.expiresAt);
    });

    it('should return false when another agent is processing', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-xyz');

      expect(result).toBe(false);
    });
  });

  describe('renewProcessing', () => {
    it('should return true when agent owns the lock', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.renewProcessing('session-123', 'agent-abc');

      expect(result).toBe(true);
      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.ExpressionAttributeValues?.[':agentId']).toBe('agent-abc');
      expect(input.ConditionExpression).toBe('processingAgentId = :agentId');
    });

    it('should return false when lock owned by another agent (conditional fail)', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await sessionStateManager.renewProcessing('session-123', 'agent-abc');

      expect(result).toBe(false);
    });
  });

  describe('addPendingMessage', () => {
    it('should add a message and set long TTL', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-123', 'Hello world');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('pendingMessages');
      expect(input.ExpressionAttributeValues?.[':exp']).toBeDefined();
    });
  });

  describe('clearPendingMessages', () => {
    it('should clear specific messages with conditional update', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      const msg2 = { id: 'msg-2', content: 'test2', timestamp: 2000 };

      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1, msg2] } });
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.clearPendingMessages('session-123', ['msg-1']);

      expect(ddbMock.calls()).toHaveLength(2); // 1 get + 1 update
      const updateCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(updateCall.ExpressionAttributeValues?.[':remaining']).toEqual([msg2]);
      expect(updateCall.ExpressionAttributeValues?.[':current']).toEqual([msg1, msg2]);
      expect(updateCall.ConditionExpression).toBe('pendingMessages = :current');
    });

    it('should retry once on race condition (ConditionalCheckFailed)', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };

      // First attempt: get, then update fails
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: { pendingMessages: [msg1] } })
        .resolvesOnce({ Item: { pendingMessages: [msg1, { id: 'msg-2', content: 'new' }] } });

      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';

      ddbMock.on(UpdateCommand).rejectsOnce(error).resolvesOnce({});

      await sessionStateManager.clearPendingMessages('session-123', ['msg-1']);

      // 1st attempt: GET (call 0) + UPDATE (call 1, fails)
      // 2nd attempt: GET (call 2) + UPDATE (call 3, succeeds)
      expect(ddbMock.calls()).toHaveLength(4);
    });
  });

  describe('removePendingMessage', () => {
    it('should use conditional update for safety', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.removePendingMessage('session-123', 'msg-1');

      expect(result).toBe(true);
      const updateCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(updateCall.ConditionExpression).toBe('pendingMessages = :original');
    });
  });

  describe('isProcessing', () => {
    it('should return true if agentId present and lock not expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      ddbMock.on(GetCommand).resolves({
        Item: {
          processingAgentId: 'agent-1',
          lockExpiresAt: now + 60,
          sessionId: 's1',
        },
      });

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(true);
    });

    it('should return false if lock expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      ddbMock.on(GetCommand).resolves({
        Item: {
          processingAgentId: 'agent-1',
          lockExpiresAt: now - 10,
          sessionId: 's1',
        },
      });

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(false);
    });
  });
});
