import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPBridge } from './mcp';
import { AgentRegistry } from './registry';

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class {
      connect = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'get_repo',
            description: 'Get GitHub repo',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'repo data' }] });
      close = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: class {
      constructor(public options: unknown) {}
    },
  };
});

// Mock AgentRegistry
vi.mock('./registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('MCPBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton state if needed (not strictly possible with static but let's clear mocks)
  });

  it('should fetch and map tools from an MCP server', async () => {
    const tools = await MCPBridge.getToolsFromServer('github', 'npx @mcp/github');

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('github_get_repo');
    expect(tools[0].description).toBe('Get GitHub repo');
  });

  it('should execute an external tool', async () => {
    const tools = await MCPBridge.getToolsFromServer('github', 'npx @mcp/github');
    const result = await tools[0].execute({});

    expect(result).toContain('repo data');
  });

  it('should discover all configured external tools', async () => {
    vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue({
      github: 'npx @mcp/github',
      slack: 'npx @mcp/slack',
    });

    const allTools = await MCPBridge.getAllExternalTools();
    // github has 1 tool in our mock, slack will have 1 too
    expect(allTools.length).toBeGreaterThanOrEqual(2);
  });
});
