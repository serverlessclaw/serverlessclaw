import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';
import { AnomalySeverity, AnomalyType } from '../types/metrics';

// Mock AgentRegistry
const { mockAgentRegistry } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgentConfig: vi.fn(),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
    atomicAddAgentField: vi.fn().mockResolvedValue(0),
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
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(70);

      const newScore = await TrustManager.recordFailure('test-agent', 'Test failure', 2);

      // Default penalty is 5, severity 2 -> penalty 10
      // Default penalty is 5, severity 2 -> penalty 10. delta = -10.
      expect(newScore).toBe(70);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        -10,
        { workspaceId: undefined }
      );
    });

    it('enforces floor at MIN_SCORE (0)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'low-trust-agent',
        trustScore: 5,
      });
      // First call: atomic add produces -45
      mockAgentRegistry.atomicAddAgentField
        .mockResolvedValueOnce(-45)
        // Second call: clamp correction (+45 to bring from -45 to 0)
        .mockResolvedValueOnce(0);

      const newScore = await TrustManager.recordFailure('low-trust-agent', 'Critical failure', 10);

      // Score should be clamped to MIN_SCORE (0), not allowed to go negative
      expect(newScore).toBe(0);
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

      // Quality 0 -> 1.5x penalty. Base penalty = 5 * severity(1) = 5. Total = 7.5. delta = -7.5
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(50));
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(42.5);
      const q0 = await TrustManager.recordFailure('test-agent', 'Q0', 1, 0);
      expect(q0).toBe(42.5);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        -7.5,
        { workspaceId: undefined }
      );

      // Quality 10 -> 0.5x penalty. 50 - (5 * 0.5) = 47.5. delta = -2.5
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(50));
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(47.5);
      const q10 = await TrustManager.recordFailure('test-agent', 'Q10', 1, 10);
      expect(q10).toBe(47.5);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        -2.5,
        { workspaceId: undefined }
      );
    });

    it('penalizes based on anomaly severity (batched)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValue({
        id: 'anomaly-agent',
        trustScore: 90,
        enabled: true,
      });
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(74.5);

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

      // Critical (3x) + Low (0.1x) = 3.1x default penalty (5) = 15.5. delta = -15.5
      expect(newScore).toBe(74.5);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'anomaly-agent',
        'trustScore',
        -15.5,
        { workspaceId: undefined }
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
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(82);
      const highQualityScore = await TrustManager.recordSuccess('test-agent', 10);
      expect(highQualityScore).toBe(82);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        2,
        { workspaceId: undefined }
      );

      // Quality 5 -> 1x bump. 5 * 0.2 = 1. Total bump = 1.
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig(80));
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(81);
      const avgQualityScore = await TrustManager.recordSuccess('test-agent', 5);
      expect(avgQualityScore).toBe(81);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        1,
        { workspaceId: undefined }
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
      // First call: atomic add produces 101.5
      mockAgentRegistry.atomicAddAgentField
        .mockResolvedValueOnce(101.5)
        // Second call: clamp correction (-1.5 to bring from 101.5 to 100)
        .mockResolvedValueOnce(100);

      const newScore = await TrustManager.recordSuccess('top-agent', 10);

      // Score should be clamped to MAX_SCORE (100)
      expect(newScore).toBe(100);
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'top-agent',
        'trustScore',
        expect.any(Number),
        { workspaceId: undefined }
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
      mockAgentRegistry.atomicAddAgentField.mockResolvedValue(undefined);

      await TrustManager.decayTrustScores();

      // Default decay is 0.5
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'high-trust',
        'trustScore',
        -0.75, // - (0.5 * 1.5)
        { workspaceId: undefined }
      );
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'mid-trust',
        'trustScore',
        -0.62, // - (0.5 * 1.25) = -0.625, rounded
        { workspaceId: undefined }
      );
      expect(mockAgentRegistry.atomicAddAgentField).not.toHaveBeenCalledWith(
        'at-baseline',
        'trustScore',
        expect.any(Number)
      );
      expect(mockAgentRegistry.atomicAddAgentField).not.toHaveBeenCalledWith(
        'below-baseline',
        'trustScore',
        expect.any(Number)
      );
    });
  });

  describe('fallback behavior', () => {
    it('uses default score when trustScore is missing from config', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'incomplete-agent',
        name: 'Incomplete',
      });
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(92);

      const newScore = await TrustManager.recordSuccess('incomplete-agent', 10);

      expect(newScore).toBe(92); // 90 (DEFAULT_SCORE) + 2 (bump with quality 10)
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'incomplete-agent',
        'trustScore',
        2,
        { workspaceId: undefined }
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
      expect(mockAgentRegistry.atomicAddAgentField).not.toHaveBeenCalled();
    });

    it('allows trust update when agent is enabled (explicit true)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'enabled-agent',
        name: 'Enabled Agent',
        trustScore: 80,
        enabled: true,
      });
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(81);

      const result = await TrustManager.recordSuccess('enabled-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'enabled-agent',
        'trustScore',
        1,
        { workspaceId: undefined }
      );
    });

    it('allows trust update when enabled is undefined (backward compat)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'legacy-agent',
        name: 'Legacy Agent',
        trustScore: 80,
        // enabled not set - should allow updates for backward compatibility
      });
      mockAgentRegistry.atomicAddAgentField.mockResolvedValueOnce(81);

      const result = await TrustManager.recordSuccess('legacy-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicAddAgentField).toHaveBeenCalledWith(
        'legacy-agent',
        'trustScore',
        1,
        { workspaceId: undefined }
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
      expect(mockAgentRegistry.atomicAddAgentField).not.toHaveBeenCalled();
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
      mockAgentRegistry.atomicAddAgentField.mockRejectedValueOnce(new Error('DDB_FAILURE'));

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
