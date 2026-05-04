import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './trace-cleanup';
import { resetDocClient } from '../lib/utils/ddb-client';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'TraceTable' },
  },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('trace-cleanup handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    resetDocClient(); // Ensure singleton is fresh
  });

  it('should query traces with correct reserved keyword aliasing', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ traceId: 't1', nodeId: 'n1', status: 'started', timestamp: 100 }],
    });
    ddbMock.on(DeleteCommand).resolves({});

    await handler();

    const queryCalls = ddbMock.calls().filter((c) => c.args[0] instanceof QueryCommand);
    expect(queryCalls.length).toBeGreaterThan(0);

    const firstQuery = queryCalls[0].args[0].input as any;
    expect(firstQuery.KeyConditionExpression).toContain('#status = :status AND #ts < :threshold');
    expect(firstQuery.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#ts': 'timestamp',
    });
    expect(firstQuery.IndexName).toBe('status-index');
  });

  it('should delete each found trace and try summary', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ traceId: 't1', nodeId: 'n1', status: 'started', timestamp: 100 }],
    });
    ddbMock.on(DeleteCommand).resolves({});

    await handler();

    const deleteCalls = ddbMock.calls().filter((c) => c.args[0] instanceof DeleteCommand);
    // 1 for the node, 1 for the summary
    expect(deleteCalls.length).toBe(2);
    expect((deleteCalls[0].args[0].input as any).Key).toEqual({ traceId: 't1', nodeId: 'n1' });
    expect((deleteCalls[1].args[0].input as any).Key).toEqual({
      traceId: 't1',
      nodeId: '__summary__',
    });
  });

  it('should handle empty query results', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler();

    const deleteCalls = ddbMock.calls().filter((c) => c.args[0] instanceof DeleteCommand);
    expect(deleteCalls.length).toBe(0);
  });
});
