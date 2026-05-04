import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillRegistry } from './skills';
import { AgentRegistry } from './registry';

// Mock tools
vi.mock('../tools/index', () => ({
  TOOLS: {
    tool1: { name: 'tool1', description: 'Search for files', parameters: {} },
    tool2: { name: 'tool2', description: 'Deploy to AWS', parameters: {} },
  },
}));

// Mock AgentRegistry
vi.mock('./registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
    saveRawConfig: vi.fn(),
    getRawConfig: vi.fn().mockResolvedValue({}),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
    initializeToolStats: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock ConfigManager
vi.mock('./registry/config', () => ({
  ConfigManager: {
    atomicAppendToMapList: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock MCPBridge
vi.mock('./mcp/mcp-bridge', () => ({
  MCPBridge: {
    getExternalTools: vi.fn().mockResolvedValue([]),
  },
}));

describe('SkillRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverSkills', () => {
    it('should find skills based on keyword query including external tools', async () => {
      const { MCPBridge } = await import('./mcp/mcp-bridge');
      vi.mocked(MCPBridge.getExternalTools).mockResolvedValueOnce([
        { name: 'external_tool', description: 'Query some API', parameters: {} } as any,
      ]);

      const results = await SkillRegistry.discoverSkills('query');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('external_tool');
    });

    it('should find skills based on keyword query', async () => {
      const results = await SkillRegistry.discoverSkills('deploy');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('tool2');
    });

    it('should return multiple results for broad queries', async () => {
      const results = await SkillRegistry.discoverSkills('search deploy');
      expect(results).toHaveLength(2);
    });

    it('should return empty if no matches', async () => {
      const results = await SkillRegistry.discoverSkills('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('installSkill', () => {
    it('should add skill with TTL to batch overrides', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue({
        id: 'agent-1',
        name: 'Agent 1',
        tools: ['recallKnowledge'],
        systemPrompt: '...',
        enabled: true,
      } as any);

      const now = Date.now();
      vi.stubGlobal('Date', { now: () => now });

      const { ConfigManager } = await import('./registry/config');
      await SkillRegistry.installSkill('agent-1', 'tool1', { ttlMinutes: 10 });

      expect(ConfigManager.atomicAppendToMapList).toHaveBeenCalledWith(
        'agent_tool_overrides',
        'agent-1',
        [{ name: 'tool1', expiresAt: now + 10 * 60 * 1000 }],
        expect.objectContaining({ preventDuplicates: true })
      );

      vi.unstubAllGlobals();
    });

    it('should add skill to agent config using batch overrides', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue({
        id: 'agent-1',
        name: 'Agent 1',
        tools: ['recallKnowledge'],
        systemPrompt: '...',
        enabled: true,
      } as any);

      const { ConfigManager } = await import('./registry/config');
      await SkillRegistry.installSkill('agent-1', 'tool1');

      expect(ConfigManager.atomicAppendToMapList).toHaveBeenCalledWith(
        'agent_tool_overrides',
        'agent-1',
        ['tool1'],
        expect.objectContaining({ preventDuplicates: true })
      );
    });

    it('should not add duplicate skills', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue({
        id: 'agent-1',
        name: 'Agent 1',
        tools: ['tool1'],
        systemPrompt: '...',
        enabled: true,
        isBackbone: true,
      } as any);

      const { ConfigManager } = await import('./registry/config');
      await SkillRegistry.installSkill('agent-1', 'tool1');

      expect(ConfigManager.atomicAppendToMapList).not.toHaveBeenCalled();
    });
  });
});
