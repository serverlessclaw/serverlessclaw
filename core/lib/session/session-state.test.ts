import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { SessionStateManager } from './session-state';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-abc');

      expect(result).toBe(true);
      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.ExpressionAttributeValues?.[':agentId']).toBe('agent-abc');
      expect(input.ExpressionAttributeValues?.[':lockExp']).toBeDefined();
      expect(input.ExpressionAttributeValues?.[':exp']).toBeDefined();
    });

    it('should return false when another agent is processing', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-xyz');

      expect(result).toBe(false);
    });

    it('should preserve existing pending messages when acquiring lock', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.acquireProcessing('session-123', 'agent-abc');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;

      expect(call.args[0].constructor.name).toBe('UpdateCommand');
      expect(input.UpdateExpression).toContain(
        'pendingMessages = if_not_exists(pendingMessages, :empty)'
      );
    });

    it('should throw on non-conditional errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Network error'));

      await expect(
        sessionStateManager.acquireProcessing('session-123', 'agent-abc')
      ).rejects.toThrow('Network error');
    });

    it('should use SESSION_STATE# prefix for key', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.acquireProcessing('my-session', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.Key?.userId).toBe('SESSION_STATE#my-session');
    });

    it('should set timestamp to 0', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.acquireProcessing('session-1', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.Key?.timestamp).toBe(0);
    });

    it('should set sessionId in update expression', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.acquireProcessing('sess-1', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.ExpressionAttributeValues?.[':sessionId']).toBe('sess-1');
    });

    it('should set condition to check processingAgentId', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.acquireProcessing('session-1', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.ConditionExpression).toContain('processingAgentId');
    });
  });

  describe('releaseProcessing', () => {
    it('should release processing flag', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.releaseProcessing('session-123');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('processingAgentId = :null');
    });

    it('should handle errors gracefully', async () => {
      const { logger } = await import('../logger');
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB error'));

      await expect(sessionStateManager.releaseProcessing('session-123')).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });

    it('should set processingStartedAt to null', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.releaseProcessing('session-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('processingStartedAt = :null');
    });

    it('should set lockExpiresAt to null', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.releaseProcessing('session-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('lockExpiresAt = :null');
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

    it('should return false when lock owned by another agent', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await sessionStateManager.renewProcessing('session-123', 'agent-abc');

      expect(result).toBe(false);
    });

    it('should return false on other errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Network error'));

      const result = await sessionStateManager.renewProcessing('session-1', 'agent-1');

      expect(result).toBe(false);
    });

    it('should update lockExpiresAt', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.renewProcessing('session-1', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('lockExpiresAt');
    });

    it('should update session expiresAt', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.renewProcessing('session-1', 'agent-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('expiresAt');
    });
  });

  describe('addPendingMessage', () => {
    it('should add a message with long TTL', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-123', 'Hello world');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      expect(input.UpdateExpression).toContain('pendingMessages');
      expect(input.ExpressionAttributeValues?.[':exp']).toBeDefined();
    });

    it('should throw on error', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB error'));

      await expect(sessionStateManager.addPendingMessage('session-123', 'Hello')).rejects.toThrow(
        'DynamoDB error'
      );
    });

    it('should set lastMessageAt timestamp', async () => {
      const before = Date.now();
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-1', 'msg');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      const after = Date.now();
      expect(input.ExpressionAttributeValues?.[':now']).toBeGreaterThanOrEqual(before);
      expect(input.ExpressionAttributeValues?.[':now']).toBeLessThanOrEqual(after);
    });

    it('should include message content in pending message', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-1', 'my content');

      const call = ddbMock.call(0);
      const input = call.args[0].input as UpdateCommandInput;
      const msgArray = input.ExpressionAttributeValues?.[':msg'] as any[];
      expect(msgArray[0].content).toBe('my content');
    });

    it('should generate unique message IDs', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.addPendingMessage('session-1', 'msg1');
      ddbMock.reset();
      ddbMock.on(UpdateCommand).resolves({});
      await sessionStateManager.addPendingMessage('session-1', 'msg2');

      const call1 = ddbMock.call(0);
      const input1 = call1.args[0].input as UpdateCommandInput;
      const msg1 = (input1.ExpressionAttributeValues?.[':msg'] as any[])[0];

      expect(msg1.id).toMatch(/^pending_\d+_[a-z0-9]+$/);
    });
  });

  describe('getPendingMessages', () => {
    it('should return pending messages', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
    });

    it('should return empty array if no item found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should return empty array if no pending messages field', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { sessionId: 's1' } });

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const result = await sessionStateManager.getPendingMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should use consistent read', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [] } });

      await sessionStateManager.getPendingMessages('session-1');

      const call = ddbMock.call(0);
      expect((call.args[0].input as Record<string, unknown>).ConsistentRead).toBe(true);
    });
  });

  describe('clearPendingMessages', () => {
    it('should clear specific messages with conditional update', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      const msg2 = { id: 'msg-2', content: 'test2', timestamp: 2000 };

      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1, msg2] } });
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.clearPendingMessages('session-123', ['msg-1']);

      expect(ddbMock.calls()).toHaveLength(2);
      const updateCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(updateCall.ExpressionAttributeValues?.[':remaining']).toEqual([msg2]);
      expect(updateCall.ExpressionAttributeValues?.[':current']).toEqual([msg1, msg2]);
      expect(updateCall.ConditionExpression).toBe('pendingMessages = :current');
    });

    it('should retry on race condition', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };

      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: { pendingMessages: [msg1] } })
        .resolvesOnce({ Item: { pendingMessages: [msg1, { id: 'msg-2', content: 'new' }] } });

      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';

      ddbMock.on(UpdateCommand).rejectsOnce(error).resolvesOnce({});

      await sessionStateManager.clearPendingMessages('session-123', ['msg-1']);

      expect(ddbMock.calls()).toHaveLength(4);
    });

    it('should return early if no messages match', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });

      await sessionStateManager.clearPendingMessages('session-123', ['non-existent']);

      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should return early if messageIds is empty', async () => {
      await sessionStateManager.clearPendingMessages('session-123', []);

      expect(ddbMock.calls()).toHaveLength(0);
    });

    it('should throw after max retry attempts', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });

      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await expect(
        sessionStateManager.clearPendingMessages('session-123', ['msg-1'])
      ).rejects.toThrow('FAILED_TO_CLEAR_PENDING_MESSAGES_RACE_CONDITION');
    });

    it('should throw non-conditional errors immediately', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).rejects(new Error('Fatal error'));

      await expect(
        sessionStateManager.clearPendingMessages('session-123', ['msg-1'])
      ).rejects.toThrow('Fatal error');
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

    it('should return false if message not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [] } });

      const result = await sessionStateManager.removePendingMessage('session-123', 'non-existent');

      expect(result).toBe(false);
    });

    it('should return false on DynamoDB error', async () => {
      const msg1 = { id: 'msg-1', content: 'test', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB error'));

      const result = await sessionStateManager.removePendingMessage('session-123', 'msg-1');

      expect(result).toBe(false);
    });
  });

  describe('updatePendingMessage', () => {
    it('should update message content', async () => {
      const msg1 = { id: 'msg-1', content: 'old', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.updatePendingMessage(
        'session-123',
        'msg-1',
        'new content'
      );

      expect(result).toBe(true);
    });

    it('should return false if message not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [] } });

      const result = await sessionStateManager.updatePendingMessage(
        'session-123',
        'non-existent',
        'new'
      );

      expect(result).toBe(false);
    });

    it('should return false on DynamoDB error', async () => {
      const msg1 = { id: 'msg-1', content: 'old', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB error'));

      const result = await sessionStateManager.updatePendingMessage('session-123', 'msg-1', 'new');

      expect(result).toBe(false);
    });

    it('should use conditional update', async () => {
      const msg1 = { id: 'msg-1', content: 'old', timestamp: 1000 };
      ddbMock.on(GetCommand).resolves({ Item: { pendingMessages: [msg1] } });
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.updatePendingMessage('session-123', 'msg-1', 'new');

      const updateCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(updateCall.ConditionExpression).toBe('pendingMessages = :original');
    });
  });

  describe('getState', () => {
    it('should return session state', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sessionId: 'session-1',
          processingAgentId: 'agent-1',
          processingStartedAt: 1000,
          pendingMessages: [],
          lastMessageAt: 2000,
        },
      });

      const result = await sessionStateManager.getState('session-1');

      expect(result).toEqual({
        sessionId: 'session-1',
        processingAgentId: 'agent-1',
        processingStartedAt: 1000,
        pendingMessages: [],
        lastMessageAt: 2000,
      });
    });

    it('should return null if no item found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await sessionStateManager.getState('session-1');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const result = await sessionStateManager.getState('session-1');

      expect(result).toBeNull();
    });

    it('should use consistent read', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sessionId: 's1', pendingMessages: [], lastMessageAt: 0 },
      });

      await sessionStateManager.getState('session-1');

      const call = ddbMock.call(0);
      expect((call.args[0].input as Record<string, unknown>).ConsistentRead).toBe(true);
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

    it('should return false if no item found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(false);
    });

    it('should return false if no processingAgentId', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sessionId: 's1' },
      });

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(false);
    });

    it('should return false if lockExpiresAt is 0', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          processingAgentId: 'agent-1',
          lockExpiresAt: 0,
        },
      });

      const result = await sessionStateManager.isProcessing('session-123');
      expect(result).toBe(false);
    });
  });
});
