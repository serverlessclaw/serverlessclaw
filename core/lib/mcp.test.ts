import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPBridge } from './mcp';
import { AgentRegistry } from './registry';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (MCPBridge as any).clients.clear();
  });

  it('should lazy load ONLY requested servers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
    });

    const tools = await MCPBridge.getExternalTools(['srv1_test_tool']);

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('srv1_test_tool');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((MCPBridge as any).clients.size).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((MCPBridge as any).clients.has('srv1')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((MCPBridge as any).clients.has('srv2')).toBe(false);
  });

  it('should load all servers if no requestedTools provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
    });

    const tools = await MCPBridge.getExternalTools();

    // Default servers (7) + our mock servers (2) = 9
    expect(tools.length).toBe(9);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((MCPBridge as any).clients.size).toBe(9);
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

    // Should not have created an MCP client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((MCPBridge as any).clients.size).toBe(0);

    // Execution should be a placeholder
    const result = await tools[0].execute({});
    expect(result).toContain('managed by the model provider');
  });
});
