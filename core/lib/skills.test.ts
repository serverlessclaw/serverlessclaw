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
  },
}));

// Mock MCPMultiplexer
vi.mock('./mcp', () => ({
  MCPMultiplexer: {
    getExternalTools: vi.fn().mockResolvedValue([]),
  },
}));

describe('SkillRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverSkills', () => {
    it('should find skills based on keyword query including external tools', async () => {
      const { MCPMultiplexer } = await import('./mcp');
      vi.mocked(MCPMultiplexer.getExternalTools).mockResolvedValueOnce([
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

      await SkillRegistry.installSkill('agent-1', 'tool1', 10);

      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        'agent_tool_overrides',
        expect.objectContaining({
          'agent-1': expect.arrayContaining([{ name: 'tool1', expiresAt: now + 10 * 60 * 1000 }]),
        })
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

      await SkillRegistry.installSkill('agent-1', 'tool1');

      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        'agent_tool_overrides',
        expect.objectContaining({
          'agent-1': expect.arrayContaining(['tool1']),
        })
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

      await SkillRegistry.installSkill('agent-1', 'tool1');

      expect(AgentRegistry.saveRawConfig).not.toHaveBeenCalled();
    });
  });
});
