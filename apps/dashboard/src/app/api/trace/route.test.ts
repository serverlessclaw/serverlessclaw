import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from './route';
import { NextRequest } from 'next/server';
import * as ddbUtils from '@claw/core/lib/utils/ddb-client';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

// Mock Logger
vi.mock('@claw/core/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock DDB Client utils
vi.mock('@claw/core/lib/utils/ddb-client', () => ({
  getTraceTableName: vi.fn(() => 'test-trace-table'),
}));

// Mock Next Cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Trace API - DELETE', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  it('returns 400 if traceId is missing', async () => {
    const req = new NextRequest('http://localhost/api/trace');
    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing traceId');
  });

  it('returns 500 if table name is not found', async () => {
    vi.mocked(ddbUtils.getTraceTableName).mockReturnValueOnce(undefined);

    const req = new NextRequest('http://localhost/api/trace?traceId=123');
    const res = await DELETE(req);
    expect(res.status).toBe(500);
  });

  it('deletes a specific traceId', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ traceId: '123', nodeId: 'node-1' }],
    });
    ddbMock.on(BatchWriteCommand).resolves({
      UnprocessedItems: {},
    });

    const req = new NextRequest('http://localhost/api/trace?traceId=123');
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(ddbMock.calls()).toHaveLength(2);
  });

  it('handles "all" traceId purge', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ traceId: 't1', nodeId: 'n1' }],
      LastEvaluatedKey: undefined,
    });
    ddbMock.on(BatchWriteCommand).resolves({
      UnprocessedItems: {},
    });

    const req = new NextRequest('http://localhost/api/trace?traceId=all');
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('handles DynamoDB errors', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('DynamoDB Error'));

    const req = new NextRequest('http://localhost/api/trace?traceId=123');
    const res = await DELETE(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('DynamoDB Error');
  });

  it('handles Throttling and retries during purge', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ traceId: 't1', nodeId: 'n1' }],
    });

    const throttlingError = new Error('Throttling');
    throttlingError.name = 'ThrottlingException';

    ddbMock.on(BatchWriteCommand).rejectsOnce(throttlingError).resolves({ UnprocessedItems: {} });

    const req = new NextRequest('http://localhost/api/trace?traceId=all');

    vi.useFakeTimers();
    const promise = DELETE(req);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(ddbMock.calls()).toHaveLength(3);
    vi.useRealTimers();
  });

  it('handles UnprocessedItems during purge', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ traceId: 't1', nodeId: 'n1' }],
    });

    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: {
          'test-trace-table': [{ DeleteRequest: { Key: { traceId: 't1', nodeId: 'n1' } } }],
        },
      })
      .resolves({ UnprocessedItems: {} });

    const req = new NextRequest('http://localhost/api/trace?traceId=all');

    vi.useFakeTimers();
    const promise = DELETE(req);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(ddbMock.calls()).toHaveLength(3);
    vi.useRealTimers();
  });
});
