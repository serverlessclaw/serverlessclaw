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
  },
}));

describe('MCPBridge Parallel Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch tools from multiple servers in parallel and handle partial failures', async () => {
    // Mock 3 servers: srv1 (success), srv2 (failure), srv3 (success)
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
      srv3: { command: 'npx srv3' },
    });

    const mockTool1 = { name: 'tool1', description: 'desc1', inputSchema: {} };
    const mockTool3 = { name: 'tool3', description: 'desc3', inputSchema: {} };

    vi.mocked(MCPClientManager.connect).mockImplementation(async (name) => {
      if (name === 'srv1') {
        return {
          listTools: vi.fn().mockResolvedValue({ tools: [mockTool1] }),
        } as any;
      }
      if (name === 'srv2') {
        throw new Error('srv2 connection failed');
      }
      if (name === 'srv3') {
        // Slow server
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          listTools: vi.fn().mockResolvedValue({ tools: [mockTool3] }),
        } as any;
      }
      // Handle default servers that might be loaded if not filtering
      return { listTools: vi.fn().mockResolvedValue({ tools: [] }) } as any;
    });

    // We only request tools from srv1, srv2, and srv3 to keep the test focused
    const tools = await MCPBridge.getExternalTools(['srv1_tool1', 'srv2_tool2', 'srv3_tool3']);

    // Should have tool1 and tool3, but tool2 should be missing due to srv2 failure
    expect(tools.length).toBe(2);
    expect(tools.map((t) => t.name)).toContain('srv1_tool1');
    expect(tools.map((t) => t.name)).toContain('srv3_tool3');
    expect(tools.map((t) => t.name)).not.toContain('srv2_tool2');

    // Verify srv1 and srv3 were connected to
    expect(MCPClientManager.connect).toHaveBeenCalledWith(
      'srv1',
      expect.stringContaining('srv1'),
      undefined
    );
    expect(MCPClientManager.connect).toHaveBeenCalledWith(
      'srv2',
      expect.stringContaining('srv2'),
      undefined
    );
    expect(MCPClientManager.connect).toHaveBeenCalledWith(
      'srv3',
      expect.stringContaining('srv3'),
      undefined
    );

    // Verify deleteClient was called for srv2
    expect(MCPClientManager.deleteClient).toHaveBeenCalledWith('srv2');
  });

  it('should attempt hub connection for hub-enabled servers', async () => {
    const hubUrl = 'http://localhost:3000';
    process.env.MCP_HUB_URL = hubUrl;

    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
    });

    const mockClient = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    };
    vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

    await MCPBridge.getExternalTools(['srv1_tool']);

    // First call should be to hubURL
    expect(MCPClientManager.connect).toHaveBeenCalledWith(
      'srv1',
      'http://localhost:3000/srv1',
      undefined
    );

    delete process.env.MCP_HUB_URL;
  });

  it('should only request specific servers when requestedTools is provided', async () => {
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { command: 'npx srv1' },
      srv2: { command: 'npx srv2' },
      srv3: { command: 'npx srv3' },
    });

    const mockClient = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    };
    vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

    // Only request tools from srv1
    await MCPBridge.getExternalTools(['srv1_tool']);

    // Should only connect to srv1
    expect(MCPClientManager.connect).toHaveBeenCalledTimes(1);
    expect(MCPClientManager.connect).toHaveBeenCalledWith('srv1', expect.any(String), undefined);
  });
});
