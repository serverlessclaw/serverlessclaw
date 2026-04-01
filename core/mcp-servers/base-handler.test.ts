import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMCPServerHandler, createHealthCheckHandler } from './base-handler';

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('/usr/bin/npx\n'),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('@aws/run-mcp-servers-with-aws-lambda', () => ({
  stdioServerAdapter: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { stdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';
import { logger } from '../lib/logger';

function makeEvent(body?: string) {
  return {
    body: body ?? JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    path: '/mcp',
    httpMethod: 'POST',
    headers: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    resource: '',
    requestContext: {} as any,
  } as any;
}

function makeContext() {
  return {
    awsRequestId: 'test-request-id-123',
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    memoryLimitInMB: '128',
    logGroupName: '/aws/lambda/test',
    logStreamName: '2026/04/01/test',
    getRemainingTimeInMillis: () => 30000,
    callbackWaitsForEmptyEventLoop: true,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  } as any;
}

type LambdaHandler = (event: any, context: any) => Promise<any>;

describe('createMCPServerHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MCP_SERVER_NAME;
  });

  it('creates a handler function', () => {
    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] });
    expect(typeof handler).toBe('function');
  });

  it('creates handler for npx command', () => {
    const handler = createMCPServerHandler({
      command: 'npx',
      args: ['test-server'],
      env: { HOME: '/tmp' },
    });
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('creates handler for non-npx command', () => {
    const handler = createMCPServerHandler({ command: 'node', args: ['server.js'] });
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('returns 200 on successful handler execution', async () => {
    const mockResult = { content: [{ type: 'text', text: 'hello' }] };
    vi.mocked(stdioServerAdapter).mockResolvedValue(mockResult);

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

    const body = JSON.parse(result.body);
    expect(body).toEqual(mockResult);
  });

  it('returns 500 on handler execution error', async () => {
    vi.mocked(stdioServerAdapter).mockRejectedValue(new Error('Connection failed'));

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal server error');
    expect(body.message).toBe('Connection failed');
  });

  it('handles non-Error exceptions', async () => {
    vi.mocked(stdioServerAdapter).mockRejectedValue('string error');

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Unknown error');
  });

  it('logs request info on invocation', async () => {
    vi.mocked(stdioServerAdapter).mockResolvedValue({});
    process.env.MCP_SERVER_NAME = 'my-server';

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    await handler(makeEvent(), makeContext());

    expect(logger.info).toHaveBeenCalledWith(
      'MCP Server my-server invoked',
      expect.objectContaining({ requestId: 'test-request-id-123' })
    );
  });

  it('uses "unknown" server name when env var not set', async () => {
    vi.mocked(stdioServerAdapter).mockResolvedValue({});
    delete process.env.MCP_SERVER_NAME;

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    await handler(makeEvent(), makeContext());

    expect(logger.info).toHaveBeenCalledWith('MCP Server unknown invoked', expect.any(Object));
  });

  it('logs completion info on success', async () => {
    vi.mocked(stdioServerAdapter).mockResolvedValue({ result: 'ok' });
    process.env.MCP_SERVER_NAME = 'test-srv';

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    await handler(makeEvent(), makeContext());

    expect(logger.info).toHaveBeenCalledWith(
      'MCP Server test-srv completed',
      expect.objectContaining({ requestId: 'test-request-id-123', duration: expect.any(Number) })
    );
    delete process.env.MCP_SERVER_NAME;
  });

  it('logs error info on failure', async () => {
    vi.mocked(stdioServerAdapter).mockRejectedValue(new Error('boom'));
    process.env.MCP_SERVER_NAME = 'fail-srv';

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    await handler(makeEvent(), makeContext());

    expect(logger.error).toHaveBeenCalledWith(
      'MCP Server fail-srv failed',
      expect.objectContaining({
        requestId: 'test-request-id-123',
        error: 'boom',
      })
    );
    delete process.env.MCP_SERVER_NAME;
  });

  it('parses JSON body from event', async () => {
    vi.mocked(stdioServerAdapter).mockResolvedValue({});
    const rpcBody = { jsonrpc: '2.0', method: 'tools/call', id: 5, params: { name: 'test' } };

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    await handler(makeEvent(JSON.stringify(rpcBody)), makeContext());

    expect(stdioServerAdapter).toHaveBeenCalled();
    const callArgs = vi.mocked(stdioServerAdapter).mock.calls[0];
    expect(callArgs[1]).toEqual(rpcBody);
  });

  it('handles empty body gracefully', async () => {
    vi.mocked(stdioServerAdapter).mockResolvedValue({});

    const handler = createMCPServerHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const event = makeEvent();
    event.body = '';
    const result = await handler(event, makeContext());

    expect(result.statusCode).toBe(200);
  });
});

describe('createHealthCheckHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a handler function', () => {
    const handler = createHealthCheckHandler({ command: 'npx', args: ['test'] });
    expect(typeof handler).toBe('function');
  });

  it('returns 200 with healthy status', async () => {
    const handler = createHealthCheckHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeDefined();
  });

  it('includes server name in health response', async () => {
    process.env.MCP_SERVER_NAME = 'test-server';
    const handler = createHealthCheckHandler({ command: 'npx', args: ['test'] }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    const body = JSON.parse(result.body);
    expect(body.server).toBe('test-server');
    delete process.env.MCP_SERVER_NAME;
  });

  it('returns 200 for non-npx command', async () => {
    const handler = createHealthCheckHandler({
      command: 'node',
      args: ['server.js'],
    }) as LambdaHandler;
    const result = await handler(makeEvent(), makeContext());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('healthy');
  });
});
