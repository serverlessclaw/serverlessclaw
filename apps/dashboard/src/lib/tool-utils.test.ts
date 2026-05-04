import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tool-definitions', () => ({
  tools: {
    dispatchTask: { name: 'dispatchTask', description: 'Dispatches a task' },
    manageMemory: { name: 'manageMemory', description: 'Manages memory' },
  },
}));

vi.mock('@claw/core/lib/registry/index', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
  },
}));

vi.mock('@claw/core/lib/mcp', () => ({
  MCPMultiplexer: {
    getExternalTools: vi.fn(),
    getCachedTools: vi.fn(),
  },
}));

import { getToolUsage, getAllTools } from './tool-utils';

describe('tool-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getToolUsage', () => {
    it('returns tool usage data from registry', async () => {
      const { AgentRegistry } = await import('@claw/core/lib/registry/index');
      (AgentRegistry.getRawConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        dispatchTask: { count: 5, lastUsed: 1700000000 },
      });

      const result = await getToolUsage();

      expect(result).toEqual({
        dispatchTask: { count: 5, lastUsed: 1700000000 },
      });
    });

    it('returns empty object on error', async () => {
      const { AgentRegistry } = await import('@claw/core/lib/registry/index');
      (AgentRegistry.getRawConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB error')
      );

      const result = await getToolUsage();

      expect(result).toEqual({});
    });

    it('returns empty object when config is null', async () => {
      const { AgentRegistry } = await import('@claw/core/lib/registry/index');
      (AgentRegistry.getRawConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await getToolUsage();

      expect(result).toEqual({});
    });
  });

  describe('getAllTools', () => {
    it('returns local tools with usage stats', async () => {
      const { MCPMultiplexer } = await import('@claw/core/lib/mcp');
      (MCPMultiplexer.getCachedTools as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const usage = {
        dispatchTask: { count: 3, lastUsed: 1700000000 },
      };

      const result = await getAllTools(usage);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'dispatchTask',
            description: 'Dispatches a task',
            isExternal: false,
            usage: { count: 3, lastUsed: 1700000000 },
          }),
          expect.objectContaining({
            name: 'manageMemory',
            isExternal: false,
            usage: { count: 0, lastUsed: 0 },
          }),
        ])
      );
    });

    it('includes MCP tools from cache', async () => {
      const { MCPMultiplexer } = await import('@claw/core/lib/mcp');
      (MCPMultiplexer.getCachedTools as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'mcp_tool_1', description: 'External tool 1' },
      ]);

      const result = await getAllTools({});

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'mcp_tool_1',
            isExternal: true,
          }),
        ])
      );
    });

    it('uses forceRefresh to bypass cache', async () => {
      const { MCPMultiplexer } = await import('@claw/core/lib/mcp');
      (MCPMultiplexer.getExternalTools as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'fresh_tool', description: 'Fresh tool' },
      ]);

      const result = await getAllTools({}, { forceRefresh: true });

      expect(MCPMultiplexer.getExternalTools).toHaveBeenCalled();
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'fresh_tool',
            isExternal: true,
          }),
        ])
      );
    });

    it('falls back to skipConnection when cache is empty', async () => {
      const { MCPMultiplexer } = await import('@claw/core/lib/mcp');
      (MCPMultiplexer.getCachedTools as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (MCPMultiplexer.getExternalTools as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'fallback_tool', description: 'Fallback' },
      ]);

      const result = await getAllTools({});

      expect(MCPMultiplexer.getExternalTools).toHaveBeenCalledWith(undefined, true);
      expect(result).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'fallback_tool' })])
      );
    });

    it('returns only local tools on error', async () => {
      const { MCPMultiplexer } = await import('@claw/core/lib/mcp');
      (MCPMultiplexer.getCachedTools as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('MCP error')
      );

      const result = await getAllTools({});

      const externalTools = result.filter((t: { isExternal: boolean }) => t.isExternal);
      expect(externalTools).toHaveLength(0);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
