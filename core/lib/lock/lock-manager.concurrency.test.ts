import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockManager } from './lock-manager';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Mock docClient.send
const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: (...args: any[]) => mockSend(...args),
      }),
    },
  };
});

describe('LockManager Concurrency & Cleanup [Sh1]', () => {
  let lockManager: LockManager;
  const lockId = 'test-lock';
  const ownerId = 'agent-1';

  beforeEach(() => {
    vi.clearAllMocks();
    lockManager = new LockManager();
  });

  it('should allow acquisition if existing lock is expired', async () => {
    // Simulate expired lock condition check success
    mockSend.mockResolvedValueOnce({});

    const result = await lockManager.acquire(lockId, { ttlSeconds: 10, ownerId });

    expect(result).toBe(true);
    const command = mockSend.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toContain('expiresAt < :now');
  });

  it('should succeed in releasing a lock even if it is just expired (ownership cleanup)', async () => {
    mockSend.mockResolvedValueOnce({});

    // The release method should now work as long as owner matches, regardless of expiresAt
    const result = await lockManager.release(lockId, ownerId);

    expect(result).toBe(true);
    const command = mockSend.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toBe('ownerId = :owner');
    expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':now');
  });

  it('should fail release if owner ID does not match', async () => {
    mockSend.mockRejectedValueOnce({
      name: 'ConditionalCheckFailedException',
    });

    const result = await lockManager.release(lockId, 'wrong-owner');
    expect(result).toBe(false);
  });
});
