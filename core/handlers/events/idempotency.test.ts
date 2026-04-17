import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { checkAndMarkIdempotent } from './idempotency';

const mockSend = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({
      send: (cmd: unknown) => mockSend(cmd),
    }),
  },
  PutCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
  ConditionalCheckFailedException: class extends Error {
    name = 'ConditionalCheckFailedException';
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('checkAndMarkIdempotent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMORY_TABLE_NAME;
  });

  it('uses Resource.MemoryTable.name when env var is absent', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await checkAndMarkIdempotent('envelope-1', 'system_health_report');

    expect(result).toBe(false);
    expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
    const cmd = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input.TableName).toBe('test-memory-table');
  });

  it('prefers MEMORY_TABLE_NAME env var when provided', async () => {
    process.env.MEMORY_TABLE_NAME = 'env-memory-table';
    mockSend.mockResolvedValueOnce({});

    const result = await checkAndMarkIdempotent('envelope-2', 'task_completed');

    expect(result).toBe(false);
    const cmd = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input.TableName).toBe('env-memory-table');
  });

  it('returns true for conditional-check duplicate writes', async () => {
    const duplicate = new Error('exists');
    duplicate.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(duplicate);

    const result = await checkAndMarkIdempotent('envelope-3', 'task_completed');

    expect(result).toBe(true);
  });

  it('fails open on unexpected errors (allows processing)', async () => {
    mockSend.mockRejectedValueOnce(new Error('ddb transient outage'));

    const result = await checkAndMarkIdempotent('envelope-4', 'task_completed');

    expect(result).toBe(false);
  });
});
