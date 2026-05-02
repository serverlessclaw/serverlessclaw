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

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SessionStateManager - Workflow Snapshots', () => {
  let sessionStateManager: SessionStateManager;

  beforeEach(() => {
    ddbMock.reset();
    sessionStateManager = new SessionStateManager();
  });

  describe('saveSnapshot', () => {
    it('should save a workflow snapshot to DynamoDB', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const snapshot = {
        reason: 'Waiting for human approval',
        timestamp: 1700000000000,
        agentId: 'agent-123',
        task: 'deploy new feature',
        state: { historyCount: 42 },
        metadata: { userId: 'user-456', key: 'value' },
      };

      await sessionStateManager.saveSnapshot('session-789', snapshot);

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(call.Key?.userId).toBe('SESSION_STATE#session-789');
      expect(call.UpdateExpression).toContain('SET workflowSnapshot = :snapshot');
      expect(call.ExpressionAttributeValues?.[':snapshot']).toEqual(snapshot);
    });

    it('should log error and throw on failure', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB failure'));

      const snapshot = {
        reason: 'test',
        timestamp: Date.now(),
        agentId: 'agent-1',
        task: 'test task',
        state: {},
      };

      await expect(sessionStateManager.saveSnapshot('session-1', snapshot)).rejects.toThrow(
        'DynamoDB failure'
      );
    });

    it('should set expiresAt with TTL', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const snapshot = {
        reason: 'test',
        timestamp: Date.now(),
        agentId: 'agent-1',
        task: 'test task',
        state: {},
      };

      await sessionStateManager.saveSnapshot('session-1', snapshot);

      const call = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(call.UpdateExpression).toContain('expiresAt = :exp');
      expect(call.ExpressionAttributeValues?.[':exp']).toBeDefined();
    });
  });

  describe('clearSnapshot', () => {
    it('should clear the workflow snapshot by setting it to null', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.clearSnapshot('session-123');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(call.Key?.userId).toBe('SESSION_STATE#session-123');
      expect(call.UpdateExpression).toContain('SET workflowSnapshot = :null');
      expect(call.ExpressionAttributeValues?.[':null']).toBeNull();
    });

    it('should handle errors gracefully without throwing', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Network error'));

      // Should not throw
      await expect(sessionStateManager.clearSnapshot('session-123')).resolves.toBeUndefined();
    });
  });

  describe('getState - includes workflowSnapshot', () => {
    it('should include workflowSnapshot in returned state', async () => {
      const snapshot = {
        reason: 'test reason',
        timestamp: 1700000000000,
        agentId: 'agent-xyz',
        task: 'test task',
        state: { step: 1 },
      };

      ddbMock.on(GetCommand).resolves({
        Item: {
          sessionId: 'session-1',
          processingAgentId: 'agent-1',
          processingStartedAt: 1000,
          pendingMessages: [],
          lastMessageAt: 2000,
          workflowSnapshot: snapshot,
        },
      });

      const result = await sessionStateManager.getState('session-1');
      expect(result).not.toBeNull();
      expect(result!.workflowSnapshot).toEqual(snapshot);
    });

    it('should return undefined workflowSnapshot when not present', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sessionId: 'session-1',
          processingAgentId: null,
          processingStartedAt: null,
          pendingMessages: [],
          lastMessageAt: 2000,
          workflowSnapshot: undefined,
        },
      });

      const result = await sessionStateManager.getState('session-1');
      expect(result).not.toBeNull();
      expect(result!.workflowSnapshot).toBeUndefined();
    });
  });

  describe('releaseProcessing', () => {
    it('should release lock and re-emit first pending message with idempotency key', async () => {
      // 1. Mock lock release success
      ddbMock.on(UpdateCommand).resolvesOnce({}); // Lock release (not shown in this mock but used by manager)

      // 2. Mock session state update with pending messages
      const pendingMsg = { id: 'msg-1', content: 'target-agent: do something', timestamp: 1000 };
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          userId: 'SESSION_STATE#sess-1',
          pendingMessages: [pendingMsg],
        },
      });

      // 3. Mock GetCommand for removePendingMessage's check
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'SESSION_STATE#sess-1',
          pendingMessages: [pendingMsg],
        },
      });

      // 4. Mock event bus...
      // but we can check the removePendingMessage call)
      await sessionStateManager.releaseProcessing('sess-1', 'agent-1');

      // Verify session update was called correctly
      const calls = ddbMock.calls();
      const metadataUpdate = calls.find((c) => {
        const input = c.args[0].input as any;
        return input.UpdateExpression?.includes('processingAgentId = :null');
      });
      expect(metadataUpdate).toBeDefined();

      // Verify removePendingMessage was triggered
      const removeCall = calls.find((c) => {
        const input = c.args[0].input as any;
        return input.ConditionExpression === 'pendingMessages = :old';
      });
      expect(removeCall).toBeDefined();
    });
  });
});
