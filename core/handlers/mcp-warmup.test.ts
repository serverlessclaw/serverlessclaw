import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = mockSend;
  },
  InvokeCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
    mockSend.mockResolvedValue({});
    const { handler } = await import('./mcp-warmup');
    const result = await handler({}, {} as any, {} as any);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(2);
    expect(body.success).toBe(2);
  });

  it('should warm only specified servers', async () => {
    mockSend.mockResolvedValue({});
    const { handler } = await import('./mcp-warmup');
    const result = await handler({ servers: ['server-1'] }, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(1);
  });

  it('should handle unknown server names', async () => {
    mockSend.mockResolvedValue({});
    const { handler } = await import('./mcp-warmup');
    const result = await handler({ servers: ['unknown-server'] }, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.notFound).toBe(1);
  });

  it('should handle Lambda invoke failures', async () => {
    mockSend.mockRejectedValueOnce(new Error('Invoke failed'));
    mockSend.mockResolvedValueOnce({});
    const { handler } = await import('./mcp-warmup');
    const result = await handler({}, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.failed).toBe(1);
    expect(body.success).toBe(1);
  });

  it('should handle empty MCP_SERVER_ARNS', async () => {
    process.env.MCP_SERVER_ARNS = '{}';
    const { handler } = await import('./mcp-warmup');
    const result = await handler({}, {} as any, {} as any);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(0);
  });
});
