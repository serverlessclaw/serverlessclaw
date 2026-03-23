import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET_MCP_CONFIG } from './debug';

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
  },
}));

describe('Debug Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET_MCP_CONFIG', () => {
    it('has correct tool definition', () => {
      expect(GET_MCP_CONFIG.name).toBe('getMcpConfig');
      expect(GET_MCP_CONFIG.description).toBeDefined();
      expect(GET_MCP_CONFIG.parameters).toBeDefined();
    });

    it('returns MCP config as JSON', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue({
        servers: [{ name: 'test-server', url: 'http://localhost:3000' }],
      });

      const result = await GET_MCP_CONFIG.execute();
      const parsed = JSON.parse(result);

      expect(AgentRegistry.getRawConfig).toHaveBeenCalledWith('mcp_servers');
      expect(parsed.servers).toHaveLength(1);
      expect(parsed.servers[0].name).toBe('test-server');
    });

    it('returns empty object when config is null', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue(null);

      const result = await GET_MCP_CONFIG.execute();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({});
    });

    it('returns empty object when config is undefined', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue(undefined);

      const result = await GET_MCP_CONFIG.execute();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({});
    });

    it('returns formatted JSON with proper indentation', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValue({ test: 'value' });

      const result = await GET_MCP_CONFIG.execute();

      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('handles errors from AgentRegistry', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockRejectedValue(new Error('Registry error'));

      await expect(GET_MCP_CONFIG.execute()).rejects.toThrow('Registry error');
    });
  });
});
