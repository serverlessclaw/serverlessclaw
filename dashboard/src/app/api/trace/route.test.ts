import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSend = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },
  ScanCommand: class {},
  BatchWriteCommand: class {},
  QueryCommand: class {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

describe('Trace API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if traceId is missing', async () => {
    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Missing traceId');
  });

  it('deletes a single trace by traceId', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { traceId: 'trace-1', nodeId: 'node-1' },
          { traceId: 'trace-1', nodeId: 'node-2' },
        ],
      })
      .mockResolvedValueOnce({});

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace?traceId=trace-1');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/trace');
  });

  it('handles empty trace gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace?traceId=nonexistent');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('deletes all traces when traceId=all', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { traceId: 't1', nodeId: 'n1' },
          { traceId: 't2', nodeId: 'n2' },
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({ UnprocessedItems: {} });

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace?traceId=all');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
  });

  it('handles pagination in delete-all', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ traceId: 't1', nodeId: 'n1' }],
        LastEvaluatedKey: { traceId: 't1' },
      })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({
        Items: [{ traceId: 't2', nodeId: 'n2' }],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({ UnprocessedItems: {} });

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace?traceId=all');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.count).toBe(2);
  });

  it('returns 500 on DynamoDB error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost/api/trace?traceId=trace-1');
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });
});
