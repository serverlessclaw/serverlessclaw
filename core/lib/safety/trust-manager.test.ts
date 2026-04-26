import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';
import { AnomalySeverity, AnomalyType } from '../types/metrics';

// Mock AgentRegistry
const { mockAgentRegistry } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgentConfig: vi.fn(),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
    atomicIncrementTrustScore: vi.fn().mockImplementation(async (id, delta, opts) => {
      // Default behavior: increment from a reasonable base (80) and clamp
      const base = 80;
      let newScore = base + delta;
      if (opts?.min !== undefined) newScore = Math.max(opts.min, newScore);
      if (opts?.max !== undefined) newScore = Math.min(opts.max, newScore);
      return newScore;
    }),
    getAllConfigs: vi.fn(),
    isBackboneAgent: vi.fn((id: string) => {
      // Match the actual backbone agents
      const backboneAgents = [
        'superclaw',
        'coder',
        'strategic_planner',
        'cognition_reflector',
        'qa',
        'critic',
        'facilitator',
        'merger',
        'build_monitor',
        'recovery',
        'researcher',
        'event_handler',
        'judge',
      ];
      return backboneAgents.includes(id);
    }),
  },
}));

vi.mock('../registry', () => ({
  AgentRegistry: mockAgentRegistry,
}));

// Mock Bus
vi.mock('../utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock ConfigManager
vi.mock('../registry/config', () => ({
  ConfigManager: {
    appendToList: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TrustManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordFailure', () => {
    it('applies basic penalty based on severity', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'test-agent',
        trustScore: 80,
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(70);

      const newScore = await TrustManager.recordFailure('test-agent', 'Test failure', 2);

      // Default penalty is -5, severity 2 -> penalty -10
      expect(newScore).toBe(70);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'test-agent',
        -10,
        expect.objectContaining({ workspaceId: undefined })
      );
    });

    it('enforces floor at MIN_SCORE (0)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'low-trust-agent',
        trustScore: 5,
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(0);

      const newScore = await TrustManager.recordFailure('low-trust-agent', 'Critical failure', 10);

      // Score should be clamped to MIN_SCORE (0), not allowed to go negative
      expect(newScore).toBe(0);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'low-trust-agent',
        -50,
        expect.objectContaining({ workspaceId: undefined, min: 0 })
      );
    });
    it('applies quality weighting to failure penalties', async () => {
      const getConfig = (score: number) => ({
        id: 'test-agent',
        name: 'Test',
        trustScore: score,
        evolutionMode: 'HITL' as const,
        systemPrompt: '',
        enabled: true,
      });

      // Quality 0 -> 1.5x penalty. Base penalty = -5 * severity(1) = -5. Total = -7.5.
      mockAgentRegistry.getAgentConfig.mockResolvedValue(getConfig(50));
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(42.5);
      const q0 = await TrustManager.recordFailure('test-agent', 'Q0', 1, 0);
      expect(q0).toBe(42.5);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'test-agent',
        -7.5,
        expect.objectContaining({ workspaceId: undefined })
      );

      // Quality 10 -> 0.5x penalty. 50 + (-5 * 0.5) = 47.5. delta = -2.5
      mockAgentRegistry.getAgentConfig.mockResolvedValue(getConfig(50));
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(47.5);
      const q10 = await TrustManager.recordFailure('test-agent', 'Q10', 1, 10);
      expect(q10).toBe(47.5);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'test-agent',
        -2.5,
        expect.objectContaining({ workspaceId: undefined })
      );
    });

    it('penalizes based on anomaly severity (batched)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValue({
        id: 'anomaly-agent',
        trustScore: 90,
        enabled: true,
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(74.5);

      const anomalies = [
        {
          id: 'a1',
          agentId: 'anomaly-agent',
          detectedAt: Date.now(),
          type: AnomalyType.COGNITIVE_LOOP,
          severity: AnomalySeverity.CRITICAL,
          description: 'Loop detected',
          triggerMetrics: {},
        },
        {
          id: 'a2',
          agentId: 'anomaly-agent',
          detectedAt: Date.now(),
          type: AnomalyType.LATENCY_ANOMALY,
          severity: AnomalySeverity.LOW,
          description: 'Slightly slow',
          triggerMetrics: {},
        },
      ];

      const newScore = await TrustManager.recordAnomalies('anomaly-agent', anomalies);

      // Critical (3x) + Low (0.1x) = 3.1x default penalty (-5) = -15.5.
      expect(newScore).toBe(74.5);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'anomaly-agent',
        -15.5,
        expect.objectContaining({ workspaceId: undefined })
      );
    });
  });

  describe('recordSuccess', () => {
    it('applies quality-weighted bump to trust score', async () => {
      const getConfig = (score: number) => ({
        id: 'test-agent',
        trustScore: score,
        enabled: true,
      });

      // Quality 10 -> 2x bump. Default bump = 1. Total bump = 2.
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(80));
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(82);
      const highQualityScore = await TrustManager.recordSuccess('test-agent', 10);
      expect(highQualityScore).toBe(82);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'test-agent',
        2,
        expect.objectContaining({ workspaceId: undefined })
      );

      // Quality 5 -> 1x bump. 5 * 0.2 = 1. Total bump = 1.
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(80));
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(81);
      const avgQualityScore = await TrustManager.recordSuccess('test-agent', 5);
      expect(avgQualityScore).toBe(81);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'test-agent',
        1,
        expect.objectContaining({ workspaceId: undefined })
      );

      // Quality 0 -> 0x bump. 0 * 0.2 = 0. Total bump = 0.
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(80));
      const zeroQualityScore = await TrustManager.recordSuccess('test-agent', 0);
      expect(zeroQualityScore).toBe(80);
    });

    it('enforces ceiling at MAX_SCORE (100)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'top-agent',
        trustScore: 99.5,
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(100);

      const newScore = await TrustManager.recordSuccess('top-agent', 10);

      // Score should be clamped to MAX_SCORE (100)
      expect(newScore).toBe(100);
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'top-agent',
        2, // Quality 10 -> bump 2
        expect.objectContaining({ workspaceId: undefined, max: 100 })
      );
    });
  });

  describe('decayTrustScores', () => {
    it('applies faster decay to high scores to ensure continuous autonomy earning', async () => {
      const mockConfigs = {
        'high-trust': { trustScore: 98 }, // Above autonomy (95) -> 1.5x decay (0.75/day)
        'mid-trust': { trustScore: 88 }, // Above 85 -> 1.25x decay (0.625/day)
        'at-baseline': { trustScore: 70 }, // At baseline -> No decay
        'below-baseline': { trustScore: 65 }, // Below baseline -> No decay
      };

      mockAgentRegistry.getAllConfigs.mockResolvedValue(mockConfigs);
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValue(undefined);

      await TrustManager.decayTrustScores();

      // Default decay is 0.5
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'high-trust',
        -0.75, // - (0.5 * 1.5)
        expect.objectContaining({ workspaceId: undefined })
      );
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'mid-trust',
        -0.62, // - (0.5 * 1.25) = -0.625, rounded to -0.62 in implementation (Math.round(-62.5) = -62)
        expect.objectContaining({ workspaceId: undefined })
      );
      expect(mockAgentRegistry.atomicIncrementTrustScore).not.toHaveBeenCalledWith(
        'at-baseline',
        expect.any(Number),
        expect.any(Object)
      );
      expect(mockAgentRegistry.atomicIncrementTrustScore).not.toHaveBeenCalledWith(
        'below-baseline',
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('fallback behavior', () => {
    it('uses default score when trustScore is missing from config', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'incomplete-agent',
        name: 'Incomplete',
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(92);

      const newScore = await TrustManager.recordSuccess('incomplete-agent', 10);

      expect(newScore).toBe(92); // 90 (DEFAULT_SCORE) + 2 (bump with quality 10)
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'incomplete-agent',
        2,
        expect.objectContaining({ workspaceId: undefined })
      );
    });

    it('uses default score when config is null', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(null);

      await expect(TrustManager.recordSuccess('missing-agent', 10)).rejects.toThrow(
        'Agent missing-agent not found'
      );
    });
  });

  describe('Selection Integrity (Principle 14)', () => {
    it('skips trust update when agent is disabled', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'disabled-agent',
        name: 'Disabled Agent',
        trustScore: 75,
        enabled: false,
      });

      const result = await TrustManager.recordSuccess('disabled-agent');

      // Should return current score without updating
      expect(result).toBe(75);
      expect(mockAgentRegistry.atomicIncrementTrustScore).not.toHaveBeenCalled();
    });

    it('allows trust update when agent is enabled (explicit true)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'enabled-agent',
        name: 'Enabled Agent',
        trustScore: 80,
        enabled: true,
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(81);

      const result = await TrustManager.recordSuccess('enabled-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'enabled-agent',
        1,
        expect.objectContaining({ workspaceId: undefined })
      );
    });

    it('allows trust update when enabled is undefined (backward compat)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'legacy-agent',
        name: 'Legacy Agent',
        trustScore: 80,
        // enabled not set - should allow updates for backward compatibility
      });
      mockAgentRegistry.atomicIncrementTrustScore.mockResolvedValueOnce(81);

      const result = await TrustManager.recordSuccess('legacy-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicIncrementTrustScore).toHaveBeenCalledWith(
        'legacy-agent',
        1,
        expect.objectContaining({ workspaceId: undefined })
      );
    });

    it('skips penalty update when agent is disabled', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'disabled-agent',
        name: 'Disabled Agent',
        trustScore: 60,
        enabled: false,
      });

      const result = await TrustManager.recordFailure('disabled-agent', 'Test failure');

      expect(result).toBe(60);
      expect(mockAgentRegistry.atomicIncrementTrustScore).not.toHaveBeenCalled();
    });
  });

  describe('Fail-Closed Integrity (Principle 13)', () => {
    it('throws error (fails-closed) when atomic update fails during penalty [Sh6]', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'agent-1',
        trustScore: 90,
        enabled: true,
      });
      // Simulate DDB failure
      mockAgentRegistry.atomicIncrementTrustScore.mockRejectedValueOnce(new Error('DDB_FAILURE'));

      await expect(TrustManager.recordFailure('agent-1', 'Critical error', 5)).rejects.toThrow(
        'DDB_FAILURE'
      );

      // Verify that no fallback was used (the error propagated)
      const { logger } = await import('../logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to atomically update trust'),
        expect.any(Error)
      );
    });
  });
});
