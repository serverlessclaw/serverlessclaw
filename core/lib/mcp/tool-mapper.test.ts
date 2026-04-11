import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolMapper } from './tool-mapper';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Removed outdated security mocks as they are now handled by ToolExecutor

vi.mock('../lifecycle/error-recovery', () => ({
  withMCPResilience: vi.fn(async (_name: string, fn: () => Promise<any>) => fn()),
  isConnectionError: vi.fn((err) => err instanceof Error && err.message.includes('Connection')),
}));

vi.mock('./client-manager', () => ({
  MCPClientManager: {
    deleteClient: vi.fn(),
  },
}));

import { MCPClientManager } from './client-manager';
import { withMCPResilience, isConnectionError } from '../lifecycle/error-recovery';
import { logger } from '../logger';

vi.mocked(isConnectionError).mockImplementation(
  (err) =>
    err instanceof Error &&
    (err.message.includes('Connection') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('Socket') ||
      err.message.includes('timeout'))
);
// Security check mocks removed

function makeMockClient() {
  return {
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    listTools: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe('MCPToolMapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapTools', () => {
    it('maps raw MCP tools to ITool format', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      const tools = MCPToolMapper.mapTools('server1', client, rawTools);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('server1_read_file');
      expect(tools[0].description).toBe('Read a file');
    });

    it('prefixes tool names with server name', () => {
      const client = makeMockClient();
      const rawTools = [
        { name: 'tool_a', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('myserver', client, rawTools);
      expect(tools[0].name).toBe('myserver_tool_a');
    });

    it('uses default description when missing', () => {
      const client = makeMockClient();
      const rawTools = [{ name: 'tool_a', inputSchema: { type: 'object', properties: {} } }];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);
      expect(tools[0].description).toBe('Tool from srv server.');
    });

    it('assigns argSchema using jsonSchemaToZod', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'tool_a',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
            },
            required: ['param1'],
          },
        },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);
      expect(tools[0].argSchema).toBeDefined();
      // Should validate correctly
      expect(tools[0].argSchema?.parse({ param1: 'test' })).toEqual({ param1: 'test' });
      // Should throw on invalid
      expect(() => tools[0].argSchema?.parse({})).toThrow();
    });

    it('does not add manuallyApproved for non-filesystem tools', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'search',
          description: 'Search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ];

      const tools = MCPToolMapper.mapTools('search-srv', client, rawTools);
      expect(tools[0].parameters.properties?.manuallyApproved).toBeUndefined();
    });

    it('does not add manuallyApproved when schema is not object type', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'string' },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      expect(tools[0].parameters.properties).toBeUndefined();
    });

    it('calls client.callTool on execute', async () => {
      const client = makeMockClient();
      const rawTools = [
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);
      const result = await tools[0].execute({ message: 'hello' });

      expect(withMCPResilience).toHaveBeenCalled();
      expect(client.callTool).toHaveBeenCalledWith({
        name: 'echo',
        arguments: { message: 'hello' },
      });
      expect(result).toBe(JSON.stringify([{ type: 'text', text: 'result' }]));
    });

    it('maps filesystem tools with pathKeys', async () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'The file path' } },
          },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      expect(tools[0].pathKeys).toContain('path');
    });

    // Security error handling tests removed as enforcement moved to ToolExecutor

    it('deletes client on Connection closed error', async () => {
      const client = makeMockClient();
      vi.mocked(withMCPResilience).mockImplementationOnce(async (_name, _fn, options) => {
        if (options?.onFailure) {
          await options.onFailure(new Error('Connection closed'));
        }
        throw new Error('Connection closed');
      });

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);

      await expect(tools[0].execute({})).rejects.toThrow('Connection closed');
      expect(MCPClientManager.deleteClient).toHaveBeenCalledWith('srv');
    });

    it('does not delete client on non-connection errors', async () => {
      const client = makeMockClient();
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('Some other error'));

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);

      await expect(tools[0].execute({})).rejects.toThrow('Some other error');
      expect(MCPClientManager.deleteClient).not.toHaveBeenCalled();
    });

    it('logs error on tool execution failure', async () => {
      const client = makeMockClient();
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('fail'));

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);

      await expect(tools[0].execute({})).rejects.toThrow('fail');
      expect(logger.error).toHaveBeenCalledWith('MCP Tool Execution Error (srv:tool):', 'fail');
    });

    it('maps empty tools array', () => {
      const client = makeMockClient();
      const tools = MCPToolMapper.mapTools('srv', client, []);
      expect(tools).toEqual([]);
    });

    it('maps multiple tools at once', () => {
      const client = makeMockClient();
      const rawTools = [
        { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } },
        { name: 'c', description: 'C', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapTools('srv', client, rawTools);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['srv_a', 'srv_b', 'srv_c']);
    });

    it('successfully calls tool without internal security check', async () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'list_dir',
          description: 'List',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      await tools[0].execute({});

      expect(client.callTool).toHaveBeenCalled();
    });
  });

  describe('mapCachedTools', () => {
    it('maps cached tools without active client', () => {
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);

      const tools = MCPToolMapper.mapCachedTools('server1', rawTools, clientProvider);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('server1_read_file');
      expect(tools[0].description).toBe('Read a file');
      expect(clientProvider).not.toHaveBeenCalled();
    });

    it('defers client connection until execution', async () => {
      const rawTools = [
        {
          name: 'echo',
          description: 'Echo',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);
      expect(clientProvider).not.toHaveBeenCalled();

      await tools[0].execute({ message: 'hello' });

      expect(clientProvider).toHaveBeenCalledTimes(1);
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'echo',
        arguments: { message: 'hello' },
      });
    });

    it('does not add manuallyApproved for non-filesystem tools', () => {
      const rawTools = [
        {
          name: 'search',
          description: 'Search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ];
      const clientProvider = vi.fn().mockResolvedValue(makeMockClient());

      const tools = MCPToolMapper.mapCachedTools('search-srv', rawTools, clientProvider);

      expect(tools[0].parameters.properties?.manuallyApproved).toBeUndefined();
    });

    it('does not add manuallyApproved when schema is not object type', () => {
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'string' },
        },
      ];
      const clientProvider = vi.fn().mockResolvedValue(makeMockClient());

      const tools = MCPToolMapper.mapCachedTools('filesystem', rawTools, clientProvider);

      expect(tools[0].parameters.properties).toBeUndefined();
    });

    it('maps cached filesystem tools with pathKeys', async () => {
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'path to file' } },
          },
        },
      ];

      const tools = MCPToolMapper.mapCachedTools('filesystem', rawTools, clientProvider);
      expect(tools[0].pathKeys).toContain('path');
    });

    // Cached tool security tests removed

    it('successfully calls cached tool without internal security check', async () => {
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);
      const rawTools = [
        {
          name: 'list_dir',
          description: 'List',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      const tools = MCPToolMapper.mapCachedTools('filesystem', rawTools, clientProvider);
      await tools[0].execute({});

      expect(clientProvider).toHaveBeenCalled();
      expect(mockClient.callTool).toHaveBeenCalled();
    });

    it('deletes client on connection error', async () => {
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);
      vi.mocked(withMCPResilience).mockImplementationOnce(async (_name, _fn, options) => {
        if (options?.onFailure) {
          await options.onFailure(new Error('Connection closed'));
        }
        throw new Error('Connection closed');
      });

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);

      await expect(tools[0].execute({})).rejects.toThrow('Connection closed');
      expect(MCPClientManager.deleteClient).toHaveBeenCalledWith('srv');
    });

    it('does not delete client on non-connection errors', async () => {
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('Some other error'));

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);

      await expect(tools[0].execute({})).rejects.toThrow('Some other error');
      expect(MCPClientManager.deleteClient).not.toHaveBeenCalled();
    });

    it('logs error on tool execution failure', async () => {
      const mockClient = makeMockClient();
      const clientProvider = vi.fn().mockResolvedValue(mockClient);
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('fail'));

      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);

      await expect(tools[0].execute({})).rejects.toThrow('fail');
      expect(logger.error).toHaveBeenCalledWith('MCP Tool Execution Error (srv:tool):', 'fail');
    });

    it('maps empty tools array', () => {
      const clientProvider = vi.fn().mockResolvedValue(makeMockClient());
      const tools = MCPToolMapper.mapCachedTools('srv', [], clientProvider);
      expect(tools).toEqual([]);
    });

    it('maps multiple tools at once', () => {
      const clientProvider = vi.fn().mockResolvedValue(makeMockClient());
      const rawTools = [
        { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } },
        { name: 'c', description: 'C', inputSchema: { type: 'object', properties: {} } },
      ];

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['srv_a', 'srv_b', 'srv_c']);
    });

    it('uses default description when missing', () => {
      const rawTools = [{ name: 'tool_a', inputSchema: { type: 'object', properties: {} } }];
      const clientProvider = vi.fn().mockResolvedValue(makeMockClient());

      const tools = MCPToolMapper.mapCachedTools('srv', rawTools, clientProvider);
      expect(tools[0].description).toBe('Tool from srv server.');
    });
  });

  describe('isConnectionError', () => {
    it('returns true for connection errors', async () => {
      const errors = [
        new Error('Connection refused'),
        new Error('ECONNREFUSED'),
        new Error('Socket hang up'),
        new Error('Connection closed'),
        new Error('Request timeout'),
      ];

      for (const error of errors) {
        const rawTools = [
          { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
        ];
        vi.mocked(withMCPResilience).mockImplementationOnce(async (_name, _fn, options) => {
          if (options?.onFailure) {
            await options.onFailure(error);
          }
          throw error;
        });

        const tools = MCPToolMapper.mapTools('srv', makeMockClient(), rawTools);
        await expect(tools[0].execute({})).rejects.toThrow(error.message);
      }

      expect(MCPClientManager.deleteClient).toHaveBeenCalledTimes(errors.length);
    });

    it('returns false for non-Error objects', async () => {
      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];
      vi.mocked(withMCPResilience).mockRejectedValueOnce('string error');

      const tools = MCPToolMapper.mapTools('srv', makeMockClient(), rawTools);

      await expect(tools[0].execute({})).rejects.toBe('string error');
      expect(MCPClientManager.deleteClient).not.toHaveBeenCalled();
    });

    it('returns false for non-connection errors', async () => {
      const rawTools = [
        { name: 'tool', description: 'desc', inputSchema: { type: 'object', properties: {} } },
      ];
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('Invalid argument'));

      const tools = MCPToolMapper.mapTools('srv', makeMockClient(), rawTools);

      await expect(tools[0].execute({})).rejects.toThrow('Invalid argument');
      expect(MCPClientManager.deleteClient).not.toHaveBeenCalled();
    });
  });
});
