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
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce({
        id: 'agent-1',
        evolutionMode: EvolutionMode.HITL,
        trustScore: 98,
      } as any);

      const result = await PromotionManager.promoteAgentToAuto('agent-1', 98);

      expect(result).toBe(true);
      expect(AgentRegistry.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        { evolutionMode: EvolutionMode.AUTO },
        undefined
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

    it('should not promote if already in AUTO mode', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce({
        id: 'agent-1',
        evolutionMode: EvolutionMode.AUTO,
        trustScore: 98,
      } as any);

      const result = await PromotionManager.promoteAgentToAuto('agent-1', 98);

      expect(result).toBe(false);
      expect(AgentRegistry.updateAgentConfig).not.toHaveBeenCalled();
    });

    it('should not promote if trust is below threshold', async () => {
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce({
        id: 'agent-1',
        evolutionMode: EvolutionMode.HITL,
        trustScore: 90,
      } as any);

      const result = await PromotionManager.promoteAgentToAuto('agent-1', 90);

      expect(result).toBe(false);
      expect(AgentRegistry.updateAgentConfig).not.toHaveBeenCalled();
    });
  });
});
