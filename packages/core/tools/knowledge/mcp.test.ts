import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: (...args: unknown[]) => mockGetRawConfig(...args),
    saveRawConfig: (...args: unknown[]) => mockSaveRawConfig(...args),
  },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

const mockGetRawConfig = vi.fn();
const mockSaveRawConfig = vi.fn();

import { registerMCPServer, unregisterMCPServer } from './mcp';

describe('registerMCPServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(registerMCPServer.name).toBe('registerMCPServer');
    expect(registerMCPServer.description).toBeDefined();
    expect(registerMCPServer.parameters).toBeDefined();
  });

  it('registers a new local MCP server successfully', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
      command: 'npx @mcp/server-git',
      env: '{}',
    });

    expect(result).toBe("Successfully registered local MCP server 'git'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
    });
  });

  it('registers a new remote MCP server successfully', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'remote-search',
      type: 'remote',
      url: 'https://mcp.example.com/search',
    });

    expect(result).toBe("Successfully registered remote MCP server 'remote-search'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      'remote-search': { type: 'remote', url: 'https://mcp.example.com/search' },
    });
  });

  it('registers a new managed MCP server successfully', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'gdrive',
      type: 'managed',
      connector_id: 'connector_googledrive',
    });

    expect(result).toBe("Successfully registered managed MCP server 'gdrive'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      gdrive: { type: 'managed', connector_id: 'connector_googledrive' },
    });
  });

  it('registers with environment variables as JSON string', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);
    mockSaveRawConfig.mockResolvedValue(undefined);

    const envJson = JSON.stringify({ API_KEY: 'abc123', DEBUG: 'true' });
    const result = await registerMCPServer.execute({
      serverName: 'search',
      type: 'local',
      command: 'npx @mcp/server-search',
      env: envJson,
    });

    expect(result).toBe("Successfully registered local MCP server 'search'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      search: {
        type: 'local',
        command: 'npx @mcp/server-search',
        env: { API_KEY: 'abc123', DEBUG: 'true' },
      },
    });
  });

  it('preserves existing servers when registering a new one', async () => {
    mockGetRawConfig.mockResolvedValue({
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
    });
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'search',
      type: 'local',
      command: 'npx @mcp/server-search',
      env: '{}',
    });

    expect(result).toBe("Successfully registered local MCP server 'search'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
      search: { type: 'local', command: 'npx @mcp/server-search', env: {} },
    });
  });

  it('overwrites an existing server with the same name', async () => {
    mockGetRawConfig.mockResolvedValue({
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
    });
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
      command: 'npx @mcp/server-git-v2',
      env: '{"TOKEN": "new"}',
    });

    expect(result).toBe("Successfully registered local MCP server 'git'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      git: { type: 'local', command: 'npx @mcp/server-git-v2', env: { TOKEN: 'new' } },
    });
  });

  it('returns error message when local command is missing', async () => {
    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
    });

    expect(result).toBe('FAILED: "command" is required for local MCP servers.');
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });

  it('returns error message when remote url is missing', async () => {
    const result = await registerMCPServer.execute({
      serverName: 'remote',
      type: 'remote',
    });

    expect(result).toBe('FAILED: "url" is required for remote MCP servers.');
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });

  it('returns error message when managed connector_id is missing', async () => {
    const result = await registerMCPServer.execute({
      serverName: 'managed',
      type: 'managed',
    });

    expect(result).toBe('FAILED: "connector_id" is required for managed MCP servers.');
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });

  it('returns error message when env JSON is invalid', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);

    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
      command: 'npx @mcp/server-git',
      env: '{invalid json}',
    });

    expect(result).toBe(
      'FAILED: Failed to parse environment variables. Ensure "env" is a valid JSON string.'
    );
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });

  it('returns error message when save fails', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);
    mockSaveRawConfig.mockRejectedValue(new Error('DynamoDB write failed'));

    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
      command: 'npx @mcp/server-git',
      env: '{}',
    });

    expect(result).toBe('Failed to register MCP server: DynamoDB write failed');
  });

  it('returns error message when getRawConfig fails', async () => {
    mockGetRawConfig.mockRejectedValue(new Error('Config read failed'));

    const result = await registerMCPServer.execute({
      serverName: 'git',
      type: 'local',
      command: 'npx @mcp/server-git',
      env: '{}',
    });

    expect(result).toBe('Failed to register MCP server: Config read failed');
  });
});

describe('unregisterMCPServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(unregisterMCPServer.name).toBe('unregisterMCPServer');
    expect(unregisterMCPServer.description).toBeDefined();
    expect(unregisterMCPServer.parameters).toBeDefined();
  });

  it('unregisters an existing MCP server successfully', async () => {
    mockGetRawConfig.mockResolvedValue({
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
      search: { type: 'local', command: 'npx @mcp/server-search', env: {} },
    });
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await unregisterMCPServer.execute({
      serverName: 'git',
    });

    expect(result).toBe("Successfully unregistered MCP server 'git'.");
    expect(mockSaveRawConfig).toHaveBeenCalledWith('mcp_servers', {
      search: { type: 'local', command: 'npx @mcp/server-search', env: {} },
    });
  });

  it('returns failure message when server is not registered', async () => {
    mockGetRawConfig.mockResolvedValue({
      git: { type: 'local', command: 'npx @mcp/server-git', env: {} },
    });

    const result = await unregisterMCPServer.execute({
      serverName: 'nonexistent',
    });

    expect(result).toBe("FAILED: MCP server 'nonexistent' is not registered.");
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });
});
