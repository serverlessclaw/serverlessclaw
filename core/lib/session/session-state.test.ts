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

const mockEmit = vi.fn();
vi.mock('../utils/bus', () => ({
  emitEvent: (...args: any[]) => mockEmit(...args),
}));

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
    it('should return true and update state when lock is acquired', async () => {
      // First call: LockManager.acquire (UpdateCommand on LOCK#SESSION#...)
      // Second call: SessionStateManager (UpdateCommand on SESSION_STATE#...)
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-abc');

      expect(result).toBe(true);
      expect(ddbMock.calls()).toHaveLength(2);

      const lockCall = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(lockCall.Key?.userId).toBe('LOCK#SESSION#session-123');

      const sessionCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(sessionCall.Key?.userId).toBe('SESSION_STATE#session-123');
      expect(sessionCall.ExpressionAttributeValues?.[':agentId']).toBe('agent-abc');
    });

    it('should return false when lock acquisition fails', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-xyz');

      expect(result).toBe(false);
      // Should stop after the failed Update call
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should handle state update failure gracefully after lock acquisition', async () => {
      ddbMock
        .on(UpdateCommand)
        .resolvesOnce({}) // Lock acquired
        .rejectsOnce(new Error('State update failed')); // State update fails

      const result = await sessionStateManager.acquireProcessing('session-123', 'agent-abc');

      expect(result).toBe(true); // Still returns true because the lock IS held
      expect(ddbMock.calls()).toHaveLength(2);
    });
  });

  describe('releaseProcessing', () => {
    it('should release lock and update state', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await sessionStateManager.releaseProcessing('session-123', 'agent-abc');

      expect(ddbMock.calls()).toHaveLength(2); // 1. Lock release, 2. Session state clear

      const lockReleaseCall = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(lockReleaseCall.Key?.userId).toBe('LOCK#SESSION#session-123');
      expect(lockReleaseCall.UpdateExpression).toContain('REMOVE ownerId');

      const sessionClearCall = ddbMock.call(1).args[0].input as UpdateCommandInput;
      expect(sessionClearCall.UpdateExpression).toContain('processingAgentId = :null');
    });

    it('should re-emit pending message if found during release', async () => {
      ddbMock
        .on(UpdateCommand)
        .resolvesOnce({}) // LockManager.release
        .resolvesOnce({
          // SessionStateManager update
          Attributes: {
            userId: 'SESSION#user-1',
            pendingMessages: [{ id: 'msg-1', content: 'coder: do stuff', attachments: [] }],
          },
        })
        .resolvesOnce({}); // removePendingMessage update

      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pendingMessages: [{ id: 'msg-1', content: 'coder: do stuff', attachments: [] }],
        },
      });

      await sessionStateManager.releaseProcessing('session-123', 'agent-abc');

      // 1. Lock state check, 2. release, 3. update session, 4. get pending, 5. remove pending
      expect(ddbMock.calls()).toHaveLength(4); // 1. release, 2. update session, 3. get pending, 4. remove pending

      // Verify re-emission
      expect(mockEmit).toHaveBeenCalledWith(
        'agent-abc.session-release',
        'dynamic_coder_task',
        expect.objectContaining({
          sessionId: 'session-123',
          task: 'do stuff',
          userId: 'SESSION#user-1',
        })
      );

      // Verify removal call
      const removeCall = ddbMock
        .calls()
        .find((c) =>
          (c.args[0].input as UpdateCommandInput).UpdateExpression?.includes('SET pendingMessages')
        );
      expect(removeCall).toBeDefined();
      expect((removeCall?.args[0].input as UpdateCommandInput).UpdateExpression).toContain(
        'SET pendingMessages = :filtered'
      );
    });
  });

  describe('renewProcessing', () => {
    it('should renew the lock', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await sessionStateManager.renewProcessing('session-123', 'agent-abc');

      expect(result).toBe(true);
      expect(ddbMock.calls()).toHaveLength(2);
      const input = ddbMock.call(0).args[0].input as UpdateCommandInput;
      expect(input.Key?.userId).toBe('LOCK#SESSION#session-123');
      expect(input.ConditionExpression).toBe('ownerId = :owner');
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
  });
});
