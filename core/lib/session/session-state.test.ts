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

  describe('addPendingMessage', () => {
    it('should add message to pending list and truncate if over 50', async () => {
      // Mock initial state: 51 messages (to simulate having just added one, as addPendingMessage appends then checks)
      const longList = Array.from({ length: 51 }, (_, i) => ({
        id: i === 50 ? 'new-id' : `msg-${i}`,
        content: i === 50 ? 'New message' : `msg ${i}`,
        attachments: [],
        timestamp: Date.now(),
      }));

      // 1. First UpdateCommand (list_append)
      ddbMock.on(UpdateCommand).resolves({});

      // 2. Subsequent GetCommand calls (getPendingMessages) return 51 items
      ddbMock.on(GetCommand).resolves({
        Item: {
          pendingMessages: longList,
        },
      });

      // 3. Second UpdateCommand (clearPendingMessages) - should be called because length > 50
      // We expect it to try to remove the oldest message (msg-0)

      await sessionStateManager.addPendingMessage('session-123', 'New message');

      const updateCalls = ddbMock.calls().filter((c) => c.args[0] instanceof UpdateCommand);
      // expect at least 2 update calls: 1 for append, 1 for truncation
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      const truncationUpdate = updateCalls.find((c) => {
        const input = c.args[0].input as UpdateCommandInput;
        return input.UpdateExpression?.includes('SET pendingMessages = :remaining');
      });

      expect(truncationUpdate).toBeDefined();
      const filteredList = (truncationUpdate?.args[0].input as UpdateCommandInput)
        .ExpressionAttributeValues?.[':remaining'];
      expect(filteredList).toHaveLength(50);
      expect(filteredList[0].id).toBe('msg-1');
      expect(filteredList[49].content).toBe('New message');
    });

    it('should handle small lists without truncation', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(GetCommand).resolves({
        Item: {
          pendingMessages: [{ id: 'msg-1', content: 'Existing', attachments: [] }],
        },
      });

      await sessionStateManager.addPendingMessage('session-123', 'New message');

      const updateCalls = ddbMock.calls().filter((c) => c.args[0] instanceof UpdateCommand);
      // Should ONLY have the append call, NO truncation call
      expect(updateCalls.length).toBe(1);
      const appendCall = updateCalls[0].args[0].input as UpdateCommandInput;
      expect(appendCall.UpdateExpression).toContain('list_append');
    });
  });
});
