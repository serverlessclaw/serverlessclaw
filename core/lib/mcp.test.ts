import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPBridge } from './mcp';
import { AgentRegistry } from './registry';
import { MCPClientManager } from './mcp/client-manager';

// Mock dependencies
vi.mock('./registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./mcp/client-manager', () => ({
  MCPClientManager: {
    connect: vi.fn(),
    deleteClient: vi.fn(),
    closeAll: vi.fn(),
  },
}));

// Mock MCP SDK
const mockConnect = vi.fn().mockResolvedValue(true);
const mockListTools = vi
  .fn()
  .mockResolvedValue({ tools: [{ name: 'test_tool', description: 'desc', inputSchema: {} }] });
const mockCallTool = vi.fn().mockResolvedValue({ content: [] });

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    close = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {},
}));

describe('MCPBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MCPClientManager.connect).mockReset();
    vi.mocked(MCPClientManager.deleteClient).mockReset();
    vi.mocked(MCPClientManager.closeAll).mockReset();
  });

  it('should lazy load ONLY requested servers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
    });

    const mockClient = {
      listTools: vi
        .fn()
        .mockResolvedValue({
          tools: [{ name: 'test_tool', description: 'desc', inputSchema: {} }],
        }),
    };
    vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

    const tools = await MCPBridge.getExternalTools(['srv1_test_tool']);

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('srv1_test_tool');

    // Verify MCPClientManager.connect was called only for srv1
    expect(MCPClientManager.connect).toHaveBeenCalledTimes(1);
    expect(MCPClientManager.connect).toHaveBeenCalledWith('srv1', expect.any(String), undefined);
  });

  it('should load all servers if no requestedTools provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
    });

    const mockClient = {
      listTools: vi
        .fn()
        .mockResolvedValue({
          tools: [{ name: 'test_tool', description: 'desc', inputSchema: {} }],
        }),
    };
    vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

    const tools = await MCPBridge.getExternalTools();

    // Default servers (7) + our mock servers (2) = 9
    expect(tools.length).toBe(9);
    // Verify MCPClientManager.connect was called for all servers
    expect(MCPClientManager.connect).toHaveBeenCalledTimes(9);
  });

  it('should correctly handle managed connectors without spawning local processes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      'google-drive': {
        type: 'managed',
        connector_id: 'connector_googledrive',
        description: 'Google Drive managed connector',
      },
    });

    const tools = await MCPBridge.getExternalTools(['google-drive']);

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('google-drive');
    expect(tools[0].connector_id).toBe('connector_googledrive');
    expect(tools[0].type).toBe('mcp');

    // Should not have created an MCP client for managed connectors
    expect(MCPClientManager.connect).not.toHaveBeenCalled();

    // Execution should be a placeholder
    const result = await tools[0].execute({});
    expect(result).toContain('managed');
  });
});
