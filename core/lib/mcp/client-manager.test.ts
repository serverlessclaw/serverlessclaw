import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClientManager } from './client-manager';

// Mock child_process for npx path resolution
const mockExecSync = vi.fn().mockReturnValue('/usr/bin/npx\n');
vi.mock('child_process', () => ({
  execSync: (cmd: string, options: any) => mockExecSync(cmd, options),
}));

// Mock fs for the fallback in npx resolution
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock MCP SDK
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    constructor(_info: any, _options: any) {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(_options: any) {}
    onclose?: () => void;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(_url: URL) {}
    onclose?: () => void;
  },
}));

vi.mock('@aws-sdk/client-lambda', () => {
  const mockSend = vi.fn().mockResolvedValue({
    Payload: new TextEncoder().encode(
      JSON.stringify({
        statusCode: 200,
        body: JSON.stringify({ jsonrpc: '2.0', result: {} }),
      })
    ),
  });

  return {
    LambdaClient: class {
      send = mockSend;
      constructor(_config: any) {}
    },
    InvokeCommand: class {
      constructor(_input: any) {}
    },
    _mockSend: mockSend,
  };
});

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn().mockResolvedValue(null),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('MCPClientManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    const { AgentRegistry } = await import('../registry');
    vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue(null);
    await MCPClientManager.closeAll();
  });

  afterEach(async () => {
    await MCPClientManager.closeAll();
    vi.useRealTimers();
  });

  it('connects via SSE if connectionString starts with http', async () => {
    const client = await MCPClientManager.connect('test-server', 'http://localhost:8080');
    expect(client).toBeDefined();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('connects via Stdio for non-http strings', async () => {
    const client = await MCPClientManager.connect('stdio-server', 'node server.js');
    expect(client).toBeDefined();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('reuses existing connection', async () => {
    const client1 = await MCPClientManager.connect('reuse-server', 'node server.js');
    const client2 = await MCPClientManager.connect('reuse-server', 'node server.js');

    expect(client1).toBe(client2);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent connection requests and ensures only one client is created', async () => {
    mockConnect.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return undefined;
    });

    const p1 = MCPClientManager.connect('concurrent-server', 'node server.js');
    const p2 = MCPClientManager.connect('concurrent-server', 'node server.js');
    const [client1, client2] = await Promise.all([p1, p2]);

    const { logger } = await import('../logger');
    expect(logger.info).toHaveBeenCalledWith('Starting new connection for concurrent-server');
    expect(logger.info).toHaveBeenCalledTimes(1);

    expect(client1).toBe(client2);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    const client3 = await MCPClientManager.connect('concurrent-server', 'node server.js');
    expect(client3).toBe(client1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('deletes client', async () => {
    await MCPClientManager.connect('delete-server', 'node server.js');
    MCPClientManager.deleteClient('delete-server');
    expect(MCPClientManager.getClient('delete-server')).toBeUndefined();
  });

  it('closes all clients', async () => {
    await MCPClientManager.connect('server1', 'node s1.js');
    await MCPClientManager.connect('server2', 'node s2.js');

    await MCPClientManager.closeAll();
    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it('throws error when spawning npx in Lambda environment', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';
    await expect(MCPClientManager.connect('npx-server', 'npx @mcp/server')).rejects.toThrow(
      "Cannot spawn local MCP server 'npx-server' using npx in Lambda environment"
    );
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  it('resolves npx path for stdio when not in Lambda', async () => {
    mockExecSync.mockReturnValue('/usr/bin/npx\n');
    const client = await MCPClientManager.connect('npx-server', 'npx @mcp/server');
    expect(client).toBeDefined();
    expect(mockExecSync).toHaveBeenCalledWith('which npx', expect.any(Object));
  });

  it('triggers circuit breaker after repeated failures', async () => {
    mockConnect.mockRejectedValue(new Error('Connection failed'));

    for (let i = 0; i < 3; i++) {
      await expect(
        MCPClientManager.connect('failing-server', 'http://localhost')
      ).rejects.toThrow();
    }

    await expect(MCPClientManager.connect('failing-server', 'http://localhost')).rejects.toThrow(
      'Circuit breaker open for failing-server'
    );
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it('respects persistent health from DynamoDB', async () => {
    const { AgentRegistry } = await import('../registry');
    vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue({
      status: 'down',
      timestamp: Date.now(),
    });

    await expect(MCPClientManager.connect('down-server', 'http://localhost')).rejects.toThrow(
      'Server down-server is currently down'
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('updates persistent health to up on successful connection', async () => {
    const { AgentRegistry } = await import('../registry');

    await MCPClientManager.connect('health-server', 'http://localhost:9090');

    expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
      'mcp_health_health-server',
      expect.objectContaining({ status: 'up' })
    );
  });

  it('marks server as down after MAX_FAILURES', async () => {
    mockConnect.mockRejectedValue(new Error('Connection failed'));
    const { AgentRegistry } = await import('../registry');

    for (let i = 0; i < 3; i++) {
      await expect(
        MCPClientManager.connect('fail-mark-down', 'http://localhost')
      ).rejects.toThrow();
    }

    expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
      'mcp_health_fail-mark-down',
      expect.objectContaining({ status: 'down' })
    );
  });

  it('uses longer timeout for hub connections', async () => {
    process.env.MCP_HUB_URL = 'http://hub.example.com';

    await MCPClientManager.connect('hub-server', 'http://hub.example.com/mcp');

    expect(mockConnect).toHaveBeenCalled();

    delete process.env.MCP_HUB_URL;
  });
});
