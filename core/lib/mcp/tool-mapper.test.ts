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

vi.mock('../utils/fs-security', () => ({
  checkFileSecurity: vi.fn().mockReturnValue(null),
}));

vi.mock('../lifecycle/error-recovery', () => ({
  withMCPResilience: vi.fn(async (_name: string, fn: () => Promise<any>) => fn()),
}));

vi.mock('./client-manager', () => ({
  MCPClientManager: {
    deleteClient: vi.fn(),
  },
}));

import { checkFileSecurity } from '../utils/fs-security';
import { MCPClientManager } from './client-manager';
import { withMCPResilience } from '../lifecycle/error-recovery';
import { logger } from '../logger';

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

    it('adds manuallyApproved parameter for filesystem tools', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      expect(tools[0].parameters.properties?.manuallyApproved).toBeDefined();
      expect(tools[0].parameters.properties?.manuallyApproved.type).toBe('boolean');
    });

    it('adds manuallyApproved parameter for tools starting with filesystem_', () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'filesystem_write',
          description: 'Write',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ];

      const tools = MCPToolMapper.mapTools('other', client, rawTools);
      expect(tools[0].parameters.properties?.manuallyApproved).toBeDefined();
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

    it('checks file security for filesystem tools with path', async () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      await tools[0].execute({ path: '/etc/passwd' });

      expect(checkFileSecurity).toHaveBeenCalledWith(
        '/etc/passwd',
        undefined,
        'MCP operation (read_file)'
      );
    });

    it('checks file security with path_to_file', async () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      await tools[0].execute({ path_to_file: '/some/file.txt' });

      expect(checkFileSecurity).toHaveBeenCalledWith(
        '/some/file.txt',
        undefined,
        'MCP operation (read_file)'
      );
    });

    it('checks file security with file_path', async () => {
      const client = makeMockClient();
      const rawTools = [
        {
          name: 'read_file',
          description: 'Read',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      await tools[0].execute({ file_path: '/some/file.txt' });

      expect(checkFileSecurity).toHaveBeenCalledWith(
        '/some/file.txt',
        undefined,
        'MCP operation (read_file)'
      );
    });

    it('returns security error when checkFileSecurity returns error', async () => {
      vi.mocked(checkFileSecurity).mockReturnValueOnce('PERMISSION_DENIED: blocked');

      const client = makeMockClient();
      const rawTools = [
        {
          name: 'write_file',
          description: 'Write',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ];

      const tools = MCPToolMapper.mapTools('filesystem', client, rawTools);
      const result = await tools[0].execute({ path: '/etc/shadow' });

      expect(result).toBe('PERMISSION_DENIED: blocked');
      expect(client.callTool).not.toHaveBeenCalled();
    });

    it('deletes client on Connection closed error', async () => {
      const client = makeMockClient();
      vi.mocked(withMCPResilience).mockRejectedValueOnce(new Error('Connection closed'));

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

    it('skips file security check when no path is provided in filesystem tool', async () => {
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

      expect(checkFileSecurity).not.toHaveBeenCalled();
      expect(client.callTool).toHaveBeenCalled();
    });
  });
});
