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

describe('SessionStateManager Race Conditions', () => {
  let sessionStateManager: SessionStateManager;

  beforeEach(() => {
    ddbMock.reset();
    sessionStateManager = new SessionStateManager();
  });

  it('fix verified: removePendingMessage uses optimistic locking to prevent message loss', async () => {
    const initialMessages = [
      { id: 'msg-A', content: 'A' },
      { id: 'msg-B', content: 'B' },
    ];

    ddbMock.on(GetCommand).resolves({
      Item: {
        pendingMessages: initialMessages,
      },
    });

    ddbMock.on(UpdateCommand).resolves({});

    await sessionStateManager.removePendingMessage('session-1', 'msg-A');

    const updateCall = ddbMock.calls().find((c) => c.args[0] instanceof UpdateCommand)?.args[0]
      .input as UpdateCommandInput;

    expect(updateCall).toBeDefined();
    expect(updateCall.UpdateExpression).toContain('SET pendingMessages = :filtered');
    expect(updateCall.ExpressionAttributeValues?.[':filtered']).toEqual([
      { id: 'msg-B', content: 'B' },
    ]);

    // FIX VERIFIED: ConditionExpression now exists to check for list drift
    expect(updateCall.ConditionExpression).toBe('pendingMessages = :old');
    expect(updateCall.ExpressionAttributeValues?.[':old']).toEqual(initialMessages);
  });

  it('fix verified: addPendingMessage uses atomic conditional to prevent exceeding 50 messages', async () => {
    ddbMock.on(UpdateCommand).rejects({
      name: 'ConditionalCheckFailedException',
      message: 'Queue full',
    });

    const sessionStateManager = new SessionStateManager();

    // Attempting to add the 51st message should throw PENDING_QUEUE_FULL
    await expect(
      sessionStateManager.addPendingMessage('session-full', 'new-message')
    ).rejects.toThrow('PENDING_QUEUE_FULL');

    // Verify the conditional check was used
    const updateCall = ddbMock.calls()[0]?.args[0]?.input as UpdateCommandInput;
    expect(updateCall).toBeDefined();
    expect(updateCall.ConditionExpression).toContain('size(pendingMessages) < :max');
    expect(updateCall.ExpressionAttributeValues?.[':max']).toBe(50);
  });

  it('should allow adding messages when queue has room', async () => {
    const messages = Array.from({ length: 49 }, (_, i) => ({
      id: `msg-${i}`,
      content: `content-${i}`,
      timestamp: Date.now() + i,
    }));

    ddbMock.on(UpdateCommand).resolves({ Attributes: { pendingMessages: messages } });

    const sessionStateManager = new SessionStateManager();

    // Should succeed - queue has room for 1 more
    await expect(
      sessionStateManager.addPendingMessage('session-not-full', 'new-message')
    ).resolves.not.toThrow();
  });
});
