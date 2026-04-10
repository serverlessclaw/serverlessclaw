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
    closeAll: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./mcp/tool-mapper', () => ({
  MCPToolMapper: {
    mapTools: vi.fn((serverName: string, _client: any, rawTools: any[]) =>
      rawTools.map((t: any) => ({
        name: `${serverName}_${t.name}`,
        description: t.description ?? `Tool from ${serverName} server.`,
        parameters: t.inputSchema,
        execute: vi.fn(),
      }))
    ),
    mapCachedTools: vi.fn((serverName: string, rawTools: any[], clientProvider: any) =>
      rawTools.map((t: any) => ({
        name: `${serverName}_${t.name}`,
        description: t.description ?? `Tool from ${serverName} server.`,
        parameters: t.inputSchema,
        execute: async (args: any) => {
          const client = await clientProvider();
          const result = await client.callTool({ name: t.name, arguments: args });
          return JSON.stringify(result.content);
        },
      }))
    ),
  },
}));

// Mock MCP SDK
const mockConnect = vi.fn().mockResolvedValue(true);
const mockListTools = vi.fn().mockResolvedValue({
  tools: [{ name: 'test_tool', description: 'desc', inputSchema: {} }],
});
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
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { type: 'local', command: 'npx srv1' },
      srv2: { type: 'local', command: 'npx srv2' },
    });

    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
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
    (AgentRegistry.getRawConfig as any).mockResolvedValue({
      srv1: { type: 'local', command: 'npx srv1' },
      srv2: { type: 'local', command: 'npx srv2' },
    });

    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'desc', inputSchema: {} }],
      }),
    };
    vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

    const tools = await MCPBridge.getExternalTools();

    // Default servers (8) + our mock servers (2) = 10
    expect(tools.length).toBe(10);
    // Verify MCPClientManager.connect was called for all servers
    expect(MCPClientManager.connect).toHaveBeenCalledTimes(10);
  });

  it('should correctly handle managed connectors without spawning local processes', async () => {
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
    expect(result).toContain('Managed');
  });

  describe('getToolsFromServer', () => {
    it('connects to server and returns mapped tools', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'search', description: 'Search tool', inputSchema: {} }],
        }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      const tools = await MCPBridge.getToolsFromServer('srv', 'npx srv');

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv', 'npx srv', undefined);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('srv_search');
    });

    it('returns empty array on connection failure', async () => {
      vi.mocked(MCPClientManager.connect).mockRejectedValue(new Error('Connection failed'));

      const tools = await MCPBridge.getToolsFromServer('srv', 'npx srv');

      expect(tools).toEqual([]);
      expect(MCPClientManager.deleteClient).toHaveBeenCalledWith('srv');
    });

    it('returns empty array on listTools failure', async () => {
      const mockClient = {
        listTools: vi.fn().mockRejectedValue(new Error('List failed')),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      const tools = await MCPBridge.getToolsFromServer('srv', 'npx srv');
      expect(tools).toEqual([]);
    });

    it('passes env to MCPClientManager.connect', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getToolsFromServer('srv', 'npx srv', { KEY: 'val' });

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv', 'npx srv', { KEY: 'val' });
    });

    it('attempts hub connection when MCP_HUB_URL is set for local commands', async () => {
      process.env.MCP_HUB_URL = 'http://hub:3000';
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 't', description: 'd', inputSchema: {} }],
        }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getToolsFromServer('mysrv', 'npx mysrv');

      expect(MCPClientManager.connect).toHaveBeenCalledWith(
        'mysrv',
        'http://hub:3000/mysrv',
        undefined
      );
      delete process.env.MCP_HUB_URL;
    });

    it('falls back to local when hub returns no tools', async () => {
      process.env.MCP_HUB_URL = 'http://hub:3000';
      const hubClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      const localClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'local_tool', description: 'Local', inputSchema: {} }],
        }),
      };
      vi.mocked(MCPClientManager.connect)
        .mockResolvedValueOnce(hubClient as any)
        .mockResolvedValueOnce(localClient as any);

      const tools = await MCPBridge.getToolsFromServer('mysrv', 'npx mysrv');

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('mysrv_local_tool');
      delete process.env.MCP_HUB_URL;
    });

    it('falls back to local when hub connection throws', async () => {
      process.env.MCP_HUB_URL = 'http://hub:3000';
      vi.mocked(MCPClientManager.connect)
        .mockRejectedValueOnce(new Error('Hub failed'))
        .mockResolvedValueOnce({
          listTools: vi.fn().mockResolvedValue({
            tools: [{ name: 't', description: 'd', inputSchema: {} }],
          }),
        } as any);

      const tools = await MCPBridge.getToolsFromServer('mysrv', 'npx mysrv');

      expect(MCPClientManager.connect).toHaveBeenCalledTimes(2);
      expect(tools).toHaveLength(1);
      delete process.env.MCP_HUB_URL;
    });

    it('skips hub when skipHubRouting is true', async () => {
      process.env.MCP_HUB_URL = 'http://hub:3000';
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getToolsFromServer('srv', 'npx srv', undefined, { skipHubRouting: true });

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv', 'npx srv', undefined);
      delete process.env.MCP_HUB_URL;
    });

    it('skips hub for http connection strings', async () => {
      process.env.MCP_HUB_URL = 'http://hub:3000';
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getToolsFromServer('srv', 'http://remote:8080');

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv', 'http://remote:8080', undefined);
      delete process.env.MCP_HUB_URL;
    });
  });

  describe('getExternalTools advanced', () => {
    it('handles string config', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: 'npx srv1',
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools(['srv1']);

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv1', 'npx srv1', undefined);
    });

    it('handles remote config type', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { type: 'remote', url: 'http://remote:8080' },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools(['srv1']);

      expect(MCPClientManager.connect).toHaveBeenCalledWith(
        'srv1',
        'http://remote:8080',
        undefined
      );
    });

    it('handles local config type with env', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { type: 'local', command: 'npx srv1', env: { KEY: 'val' } },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools(['srv1']);

      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv1', 'npx srv1', { KEY: 'val' });
    });

    it('returns skipConnection placeholders when skipConnection is true', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { command: 'npx srv1' },
      });

      const tools = await MCPBridge.getExternalTools(undefined, true);

      // srv1 + 7 default servers = 8 placeholders
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((t) => t.description.includes('Connect to see tools'))).toBe(true);
      expect(MCPClientManager.connect).not.toHaveBeenCalled();
    });

    it('saves default servers when config is null', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue(null);

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools();

      expect(AgentRegistry.saveRawConfig).toHaveBeenCalled();
    });

    it('merges default servers with existing config', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        custom: { command: 'npx custom' },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools();

      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        'mcp_servers',
        expect.objectContaining({
          custom: { command: 'npx custom' },
          filesystem: expect.any(Object),
          git: expect.any(Object),
        })
      );
    });

    it('does not save config when all defaults already exist', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        ast: { command: 'npx ast' },
        filesystem: { command: 'npx filesystem' },
        git: { command: 'npx git' },
        'google-search': { command: 'npx gs' },
        puppeteer: { command: 'npx puppeteer' },
        fetch: { command: 'npx fetch' },
        aws: { command: 'npx aws' },
        'aws-s3': { command: 'npx s3' },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools();

      expect(AgentRegistry.saveRawConfig).not.toHaveBeenCalledWith(
        'mcp_servers',
        expect.any(Object)
      );
    });

    it('handles discovery failure gracefully per server', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        good: { command: 'npx good' },
        bad: { command: 'npx bad' },
      });

      vi.mocked(MCPClientManager.connect).mockImplementation(async (name) => {
        if (name === 'bad') throw new Error('Connection refused');
        return {
          listTools: vi.fn().mockResolvedValue({
            tools: [{ name: 't', description: 'd', inputSchema: {} }],
          }),
        } as any;
      });

      const tools = await MCPBridge.getExternalTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('returns tools from multiple servers', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { command: 'npx srv1' },
        srv2: { command: 'npx srv2' },
      });

      vi.mocked(MCPClientManager.connect).mockImplementation(
        async (name) =>
          ({
            listTools: vi.fn().mockResolvedValue({
              tools: [{ name: `${name}_tool`, description: 'd', inputSchema: {} }],
            }),
          }) as any
      );

      const tools = await MCPBridge.getExternalTools();
      expect(tools.length).toBeGreaterThanOrEqual(2);
    });

    it('handles managed tool type with defaults', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        managed_srv: {
          type: 'managed',
          connector_id: 'connector_abc',
        },
      });

      const tools = await MCPBridge.getExternalTools();

      const managedTool = tools.find((t) => t.connector_id === 'connector_abc');
      expect(managedTool).toBeDefined();
      expect(managedTool!.name).toBe('managed_srv');
      expect(managedTool!.description).toBe('Managed tool for managed_srv');
    });

    it('filters servers with prefix matching on requestedTools', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { type: 'local', command: 'npx srv1' },
        srv2: { type: 'local', command: 'npx srv2' },
        srv3: { type: 'local', command: 'npx srv3' },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getExternalTools(['srv1_tool', 'srv2_other']);

      // Should connect to srv1 and srv2, but not srv3
      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv1', expect.any(String), undefined);
      expect(MCPClientManager.connect).toHaveBeenCalledWith('srv2', expect.any(String), undefined);
    });

    it('returns empty for unknown config type', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({
        srv1: { type: 'unknown_type', command: 'npx srv1' },
      });

      const tools = await MCPBridge.getExternalTools(['srv1']);
      expect(tools).toEqual([]);
    });
  });

  describe('getToolsFromServer advanced (caching)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should use cached tools if available and not stale', async () => {
      const mockTools = [
        {
          name: 'read_file',
          description: 'Read file',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
      vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key) => {
        if (key === 'mcp_tools_cache_filesystem') {
          return { tools: mockTools, timestamp: Date.now() };
        }
        return null;
      });

      const tools = await MCPBridge.getToolsFromServer('filesystem', 'node fs.js');

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('filesystem_read_file');
      expect(AgentRegistry.getRawConfig).toHaveBeenCalledWith('mcp_tools_cache_filesystem');
      expect(MCPClientManager.connect).not.toHaveBeenCalled(); // Important: no connection on discovery
    });

    it('should connect and refresh cache if stale', async () => {
      vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key) => {
        if (key === 'mcp_tools_cache_filesystem') {
          return { tools: [], timestamp: Date.now() - 5000000 }; // > 1 hour
        }
        return null;
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'new_tool' }] }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      await MCPBridge.getToolsFromServer('filesystem', 'node fs.js');

      expect(MCPClientManager.connect).toHaveBeenCalled();
      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        'mcp_tools_cache_filesystem',
        expect.objectContaining({
          tools: [{ name: 'new_tool' }],
          timestamp: expect.any(Number),
        })
      );
    });

    it('should connect when executing a cached tool', async () => {
      const mockTools = [
        {
          name: 'read_file',
          description: 'Read file',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
      vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key) => {
        if (key === 'mcp_tools_cache_filesystem') {
          return { tools: mockTools, timestamp: Date.now() };
        }
        return null;
      });

      const tools = await MCPBridge.getToolsFromServer('filesystem', 'node fs.js');

      // Mock the client for execution
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({ content: 'file content' }),
      };
      vi.mocked(MCPClientManager.connect).mockResolvedValue(mockClient as any);

      // Execute the cached tool
      const result = await tools[0].execute({ path: 'test.txt' });

      expect(MCPClientManager.connect).toHaveBeenCalled();
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: 'test.txt' },
      });
      expect(result).toBe(JSON.stringify('file content'));
    });
  });

  describe('getCachedTools', () => {
    it('returns cached tools from registry', async () => {
      const serversConfig = { server1: {}, server2: {} };
      const cachedServer1 = { tools: [{ name: 'tool1', description: 'desc1', inputSchema: {} }] };
      const cachedServer2 = { tools: [{ name: 'tool2', description: 'desc2', inputSchema: {} }] };

      (AgentRegistry.getRawConfig as any).mockImplementation((key: string) => {
        if (key === 'mcp_servers') return Promise.resolve(serversConfig);
        if (key === 'mcp_tools_cache_server1') return Promise.resolve(cachedServer1);
        if (key === 'mcp_tools_cache_server2') return Promise.resolve(cachedServer2);
        return Promise.resolve(null);
      });

      const tools = await MCPBridge.getCachedTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('server1_tool1');
      expect(tools[1].name).toBe('server2_tool2');
    });

    it('returns empty array when no cache exists', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue(null);

      const tools = await MCPBridge.getCachedTools();
      expect(tools).toEqual([]);
    });

    it('returns empty array when cache is not an array', async () => {
      (AgentRegistry.getRawConfig as any).mockResolvedValue({ some: 'object' });

      const tools = await MCPBridge.getCachedTools();
      expect(tools).toEqual([]);
    });
  });

  describe('closeAll', () => {
    it('delegates to MCPClientManager.closeAll', async () => {
      await MCPBridge.closeAll();
      expect(MCPClientManager.closeAll).toHaveBeenCalled();
    });
  });
});
