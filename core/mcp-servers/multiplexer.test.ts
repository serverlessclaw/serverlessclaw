import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type APIGatewayProxyEvent, type Context } from 'aws-lambda';
import { handler } from './multiplexer';
import { stdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';

vi.mock('@aws/run-mcp-servers-with-aws-lambda', () => ({
  stdioServerAdapter: vi.fn(),
}));

vi.mock('./registry', () => ({
  MCP_SERVER_REGISTRY: {
    git: { command: 'npx', args: ['git-server'] },
    filesystem: { command: 'npx', args: ['fs-server'] },
  },
}));

describe('MCP Multiplexer', () => {
  const mockContext: Context = {
    awsRequestId: 'test-request-id',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route to git based on path', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      path: '/mcp/git',
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'list_tools', id: 1 }),
    };

    vi.mocked(stdioServerAdapter).mockResolvedValue({ response: 'mocked-ok' } as any);

    const result = await handler(event as APIGatewayProxyEvent, mockContext, () => {});

    expect(result.statusCode).toBe(200);
    expect(stdioServerAdapter).toHaveBeenCalled();
    const [params] = vi.mocked(stdioServerAdapter).mock.calls[0];
    expect(params.args).toContain('git-server');
  });

  it('should route to filesystem based on header', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-server': 'filesystem',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'list_tools', id: 1 }),
    };

    vi.mocked(stdioServerAdapter).mockResolvedValue({ response: 'mocked-ok' } as any);

    const result = await handler(event as APIGatewayProxyEvent, mockContext, () => {});

    expect(result.statusCode).toBe(200);
    expect(stdioServerAdapter).toHaveBeenCalled();
    const [params] = vi.mocked(stdioServerAdapter).mock.calls[0];
    expect(params.args).toContain('fs-server');
  });

  it('should return 404 for unknown server', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      path: '/mcp/unknown-server',
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'list_tools', id: 1 }),
    };

    const result = await handler(event as APIGatewayProxyEvent, mockContext, () => {});

    expect(result.statusCode).toBe(404);
    expect(stdioServerAdapter).not.toHaveBeenCalled();
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not Found');
  });
});
