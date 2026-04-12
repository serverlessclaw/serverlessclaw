import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAgentTools, getToolDefinitions } from './registry-utils';
import { ITool } from '../lib/types/tool';

// Mock dependencies
const mockAgentRegistry = {
  getAgentConfig: vi.fn(),
};

const mockMCPMultiplexer = {
  getExternalTools: vi.fn().mockResolvedValue([]),
};

const mockTOOLS = {
  localTool1: { name: 'localTool1', description: 'desc1', parameters: {} } as ITool,
  localTool2: { name: 'localTool2', description: 'desc2', parameters: {} } as ITool,
};

const mockWarmupManager = vi.fn().mockImplementation(function (this: any) {
  this.smartWarmup = vi.fn().mockResolvedValue(undefined);
});

vi.mock('../lib/registry/index', () => ({
  AgentRegistry: mockAgentRegistry,
}));

vi.mock('../lib/mcp', () => ({
  MCPMultiplexer: mockMCPMultiplexer,
}));

vi.mock('./index', () => ({
  TOOLS: mockTOOLS,
}));

vi.mock('../lib/warmup', () => ({
  WarmupManager: mockWarmupManager,
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('registry-utils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAgentTools', () => {
    it('should return empty array if no config is found', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(null);
      const tools = await getAgentTools('unknown-agent');
      expect(tools).toEqual([]);
    });

    it('should return empty array if no tools are configured', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({ id: 'a1', tools: [] });
      const tools = await getAgentTools('a1');
      expect(tools).toEqual([]);
    });

    it('should return local tools matched by name', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'a1',
        tools: ['localTool1', 'nonExistentTool'],
      });
      const tools = await getAgentTools('a1');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('localTool1');
    });

    it('should return external MCP tools matched by name or prefix', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'a1',
        tools: ['mcpTool'],
      });
      const mockExternalTool = {
        name: 'mcpTool_exec',
        description: 'ext',
        parameters: {},
      } as ITool;
      mockMCPMultiplexer.getExternalTools.mockResolvedValueOnce([mockExternalTool]);

      const tools = await getAgentTools('a1');
      expect(tools).toContain(mockExternalTool);
    });

    it('should trigger smart warmup if MCP_SERVER_ARNS is present', async () => {
      process.env.MCP_SERVER_ARNS = JSON.stringify({ myServer: 'arn:xxx' });
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'a1',
        tools: ['myServer_tool'],
      });
      mockMCPMultiplexer.getExternalTools.mockResolvedValueOnce([
        { name: 'myServer_tool', description: 'd', parameters: {} } as ITool,
      ]);

      const tools = await getAgentTools('a1');
      expect(tools).toHaveLength(1);
      expect(mockWarmupManager).toHaveBeenCalled();
    });

    it('should handle smart warmup failure gracefully', async () => {
      process.env.MCP_SERVER_ARNS = JSON.stringify({ myServer: 'arn:xxx' });
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'a1',
        tools: ['myServer_tool'],
      });
      mockMCPMultiplexer.getExternalTools.mockResolvedValueOnce([
        { name: 'myServer_tool', description: 'd', parameters: {} } as ITool,
      ]);

      const mockSmartWarmup = vi.fn().mockRejectedValueOnce(new Error('Warmup failed'));
      mockWarmupManager.mockImplementationOnce(() => ({
        smartWarmup: mockSmartWarmup,
      }));

      const tools = await getAgentTools('a1');
      expect(tools).toHaveLength(1);
      // Success even if warmup fails
    });
  });

  describe('getToolDefinitions', () => {
    it('should format tools correctly for LLM', () => {
      const tools = {
        t1: { name: 't1', description: 'd1', parameters: { p1: 'v1' } } as any,
      };
      const defs = getToolDefinitions(tools);
      expect(defs).toEqual([
        {
          type: 'function',
          function: {
            name: 't1',
            description: 'd1',
            parameters: { p1: 'v1' },
          },
        },
      ]);
    });
  });
});
