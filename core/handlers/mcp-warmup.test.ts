import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handler } from './mcp-warmup';
import { mockDdbSend } from '../__mocks__/dynamodb';
import { mockLambdaSend } from '../__mocks__/lambda';

vi.mock('@aws-sdk/client-dynamodb', () => import('../__mocks__/dynamodb'));
vi.mock('@aws-sdk/lib-dynamodb', () => import('../__mocks__/dynamodb'));
vi.mock('@aws-sdk/client-lambda', () => import('../__mocks__/lambda'));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('sst', () => ({
  Resource: { MemoryTable: { name: 'test-memory-table' } },
}));

describe('mcp-warmup handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.MCP_SERVER_ARNS = JSON.stringify({
      'server-1': 'arn:aws:lambda:us-east-1:123:function:server-1',
      'server-2': 'arn:aws:lambda:us-east-1:123:function:server-2',
    });
  });

  it('should warm all servers when no specific servers requested', async () => {
    mockLambdaSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({});

    const result = await handler({}, {} as any, {} as any);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(2);
  });

  it('should warm only specified servers', async () => {
    mockLambdaSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({});

    const result = await handler({ servers: ['server-1'] }, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(1);
  });

  it('should handle unknown server names', async () => {
    mockLambdaSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({});

    const result = await handler({ servers: ['unknown-server'] }, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.skipped).toBe(1);
  });

  it('should handle Lambda invoke failures', async () => {
    mockLambdaSend.mockRejectedValueOnce(new Error('Invoke failed'));
    mockLambdaSend.mockResolvedValueOnce({});
    mockDdbSend.mockResolvedValue({});

    const result = await handler({}, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(2);
  });

  it('should handle empty MCP_SERVER_ARNS', async () => {
    process.env.MCP_SERVER_ARNS = '{}';
    const result = await handler({}, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(0);
  });
});
