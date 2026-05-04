import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockManager } from './lock-manager';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Mock ddb-client
vi.mock('../utils/ddb-client', () => ({
  getMemoryTableName: vi.fn(() => 'test-memory-table'),
  getDocClient: vi.fn(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
}));

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
    // Mock release (UpdateCommand) to succeed
    mockSend.mockResolvedValueOnce({});

    const result = await lockManager.release(lockId, ownerId);

    expect(result).toBe(true);
    // The call is the UpdateCommand
    const command = mockSend.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toBe('ownerId = :owner');
  });

  it('should fail release if owner ID does not match and not expired', async () => {
    // Mock UpdateCommand to fail condition check
    const error = new Error('ConditionalCheckFailedException');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(error);

    const result = await lockManager.release(lockId, ownerId);
    expect(result).toBe(false);
  });
});
