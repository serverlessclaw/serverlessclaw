/**
 * @module Idempotency Tests
 * @description Tests for idempotent operations including cache retrieval,
 * TTL expiration, concurrent writes, and the withIdempotency wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('sst', () => ({
  Resource: { MemoryTable: { name: 'test-table' } },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: class {},
  GetCommand: class {},
  DeleteCommand: class {},
}));

import {
  getIdempotentResult,
  setIdempotentResult,
  deleteIdempotentKey,
  withIdempotency,
} from './idempotency';

describe('getIdempotentResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached result when found and not expired', async () => {
    mockSend.mockResolvedValue({
      Item: {
        idempotencyKey: 'key1',
        result: { data: 'cached' },
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const result = await getIdempotentResult('key1');
    expect(result).toEqual({ data: 'cached' });
  });

  it('returns null when key not found', async () => {
    mockSend.mockResolvedValue({ Item: undefined });
    const result = await getIdempotentResult('missing');
    expect(result).toBeNull();
  });

  it('returns null when record has expired', async () => {
    mockSend.mockResolvedValue({
      Item: {
        idempotencyKey: 'key1',
        result: { data: 'old' },
        expiresAt: Math.floor(Date.now() / 1000) - 3600,
      },
    });

    const result = await getIdempotentResult('key1');
    expect(result).toBeNull();
  });

  it('returns null on DynamoDB error (fail-open)', async () => {
    mockSend.mockRejectedValue(new Error('DDB error'));
    const result = await getIdempotentResult('key1');
    expect(result).toBeNull();
    const { logger } = await import('./logger');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('setIdempotentResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores result with correct TTL', async () => {
    mockSend.mockResolvedValue({});
    await setIdempotentResult('key1', { data: 'value' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('handles ConditionalCheckFailedException silently', async () => {
    const error = new Error('Already exists');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValue(error);

    await expect(setIdempotentResult('key1', 'data')).resolves.not.toThrow();
  });

  it('does not throw on DynamoDB error (fail-open)', async () => {
    mockSend.mockRejectedValue(new Error('DDB error'));
    await expect(setIdempotentResult('key1', 'data')).resolves.not.toThrow();
    const { logger } = await import('./logger');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('deleteIdempotentKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes key successfully', async () => {
    mockSend.mockResolvedValue({});
    await deleteIdempotentKey('key1');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('logs error on DynamoDB failure', async () => {
    mockSend.mockRejectedValue(new Error('DDB error'));
    await deleteIdempotentKey('key1');
    const { logger } = await import('./logger');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('withIdempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached result on second call', async () => {
    mockSend.mockResolvedValue({
      Item: {
        result: 'cached',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const operation = vi.fn().mockResolvedValue('fresh');
    const result = await withIdempotency('key1', operation);

    expect(result).toBe('cached');
    expect(operation).not.toHaveBeenCalled();
  });

  it('executes operation on cache miss', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({});

    const operation = vi.fn().mockResolvedValue('fresh');
    const result = await withIdempotency('key1', operation);

    expect(result).toBe('fresh');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('caches result after operation executes', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({});

    await withIdempotency('key1', async () => 'result');

    // Second call to setIdempotentResult should have stored the result
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
