import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromotionManager } from './promotion-manager';
import { AgentRegistry } from '../registry/AgentRegistry';
import { SafetyTier, EvolutionMode, EventType } from '../types/agent';
import { emitEvent } from '../utils/bus';

// Mock dependencies
vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
  },
}));
vi.mock('../utils/bus');
vi.mock('../logger');
vi.mock('../registry/config', () => ({
  ConfigManager: {
    atomicUpdateMapEntity: vi.fn(),
  },
}));

describe('PromotionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('promoteCapability', () => {
    it('should promote an agent to PROD/AUTO and enable tool when trust is high', async () => {
      const mockConfig = {
        id: 'coder',
        trustScore: 95,
        safetyTier: SafetyTier.LOCAL,
        evolutionMode: EvolutionMode.HITL,
        tools: ['grep_search'],
      };

      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(mockConfig as any);
      vi.mocked(AgentRegistry.updateAgentConfig).mockResolvedValue({ success: true } as any);

      const result = await PromotionManager.promoteCapability(
        'coder',
        'new_tool',
        'Tests passed with 100% coverage'
      );

      expect(result.success).toBe(true);
      expect(AgentRegistry.updateAgentConfig).toHaveBeenCalledWith(
        'coder',
        {
          safetyTier: SafetyTier.PROD,
          evolutionMode: EvolutionMode.AUTO,
          tools: ['grep_search', 'new_tool'],
        },
        undefined
      );
      expect(emitEvent).toHaveBeenCalledWith(
        'promotion.manager',
        EventType.REPORT_BACK,
        expect.objectContaining({
          agentId: 'coder',
          metadata: expect.objectContaining({ toolName: 'new_tool' }),
        })
      );
    });

    it('should deny promotion if trust score is below threshold', async () => {
      const mockConfig = {
        id: 'coder',
        trustScore: 85,
      };

      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(mockConfig as any);

      const result = await PromotionManager.promoteCapability(
        'coder',
        'new_tool',
        'I tried my best'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('trust score (85) below 90');
      expect(AgentRegistry.updateAgentConfig).not.toHaveBeenCalled();
    });

    it('should handle missing agent config', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(undefined);

      const result = await PromotionManager.promoteCapability('unknown', 'tool', 'reason');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Agent unknown not found');
    });

    it('should return success but no-op if already promoted', async () => {
      const mockConfig = {
        id: 'coder',
        trustScore: 98,
        safetyTier: SafetyTier.PROD,
        evolutionMode: EvolutionMode.AUTO,
        tools: ['tool_a'],
      };

      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(mockConfig as any);

      const result = await PromotionManager.promoteCapability('coder', 'tool_a', 'reason');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already fully promoted');
      expect(AgentRegistry.updateAgentConfig).not.toHaveBeenCalled();
    });
  });

  describe('promoteAgentToAuto', () => {
    it('should promote agent when trust is above threshold', async () => {
      const { ConfigManager } = await import('../registry/config');
      vi.mocked(ConfigManager.atomicUpdateMapEntity).mockResolvedValue(undefined as any);

      const result = await PromotionManager.promoteAgentToAuto('agent-1', 98);

      expect(result).toBe(true);
      expect(ConfigManager.atomicUpdateMapEntity).toHaveBeenCalledWith(
        'system_agents_config',
        'agent-1',
        expect.objectContaining({ evolutionMode: EvolutionMode.AUTO }),
        expect.objectContaining({
          conditionExpression: expect.stringContaining('#val.#id.#mode <> :auto'),
        })
      );
      expect(emitEvent).toHaveBeenCalledWith(
        'promotion.manager',
        EventType.REPORT_BACK,
        expect.objectContaining({
          agentId: 'agent-1',
          task: expect.stringContaining('promoted to AUTO mode'),
        })
      );
    });

    it('should return false if trust is below threshold', async () => {
      const result = await PromotionManager.promoteAgentToAuto('agent-1', 90);

      expect(result).toBe(false);
      const { ConfigManager } = await import('../registry/config');
      expect(ConfigManager.atomicUpdateMapEntity).not.toHaveBeenCalled();
    });

    it('should return false if atomic update fails with ConditionalCheckFailedException', async () => {
      const { ConfigManager } = await import('../registry/config');
      vi.mocked(ConfigManager.atomicUpdateMapEntity).mockRejectedValue({
        name: 'ConditionalCheckFailedException',
      });

      const result = await PromotionManager.promoteAgentToAuto('agent-1', 98);

      expect(result).toBe(false);
    });
  });
});
