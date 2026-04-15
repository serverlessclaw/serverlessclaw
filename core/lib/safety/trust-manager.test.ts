import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';
import { TRUST } from '../constants';
import { AnomalySeverity, AnomalyType } from '../types/metrics';

// Mock AgentRegistry
const { mockAgentRegistry } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgentConfig: vi.fn(),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
    atomicUpdateAgentFieldWithCondition: vi.fn().mockResolvedValue(undefined),
    getAllConfigs: vi.fn(),
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

      const newScore = await TrustManager.recordFailure('test-agent', 'Test failure', 2);

      // Default penalty is 5, severity 2 -> penalty 10
      expect(newScore).toBe(70);
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        70,
        80
      );
    });

    it('clamps score to minimum', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'low-trust-agent',
        trustScore: 5,
      });

      const newScore = await TrustManager.recordFailure('low-trust-agent', 'Critical failure', 10);

      expect(newScore).toBe(TRUST.MIN_SCORE);
    });

    it('applies quality weighting to failure penalties', async () => {
      const getConfig = () => ({
        id: 'test-agent',
        name: 'Test',
        trustScore: 50,
        evolutionMode: 'HITL',
        systemPrompt: '',
      });

      // Low quality failure (2/10) -> higher penalty multiplier (1.5x)
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const lowQualityPenalty = await TrustManager.recordFailure(
        'test-agent',
        'Low quality failure',
        1,
        2
      );
      expect(lowQualityPenalty).toBeCloseTo(42.5, 1); // 50 - 7.5 = 42.5 (penalty * 1.5)

      // High quality failure (8/10) -> lower penalty multiplier (0.5x)
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const highQualityPenalty = await TrustManager.recordFailure(
        'test-agent',
        'High quality failure',
        1,
        8
      );
      expect(highQualityPenalty).toBeCloseTo(45.5, 1); // 50 - (5 * 0.9) = 45.5 (multiplier = (10-8)/5 + 0.5 = 0.9)
    });

    it('penalizes based on anomaly severity (batched)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValue({
        id: 'anomaly-agent',
        trustScore: 90,
      });

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

      // Critical (3x) + Low (0.1x) = 3.1x default penalty (5) = 15.5
      expect(newScore).toBe(74.5);
    });
  });

  describe('recordSuccess', () => {
    it('applies quality-weighted bump to trust score', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'good-agent',
        trustScore: 80,
      });

      // Quality 10 -> 2x bump (default bump is 1)
      const highQualityScore = await TrustManager.recordSuccess('good-agent', 10);
      expect(highQualityScore).toBe(82);

      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'avg-agent',
        trustScore: 50,
      });

      // Quality 5 -> 1x bump
      const avgQualityScore = await TrustManager.recordSuccess('avg-agent', 5);
      expect(avgQualityScore).toBe(51);
    });

    it('clamps score to maximum', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'top-agent',
        trustScore: 99.5,
      });

      const newScore = await TrustManager.recordSuccess('top-agent', 10);
      expect(newScore).toBe(100);
    });
  });

  describe('decayTrustScores', () => {
    it('applies aggressive decay to high scores and baseline decay to others', async () => {
      const mockConfigs = {
        'high-trust': { trustScore: 98 }, // Above autonomy (95) -> 1.5x decay
        'mid-trust': { trustScore: 88 }, // Above 85 -> 1.2x decay
        'at-baseline': { trustScore: 70 }, // At baseline -> 1.0x decay
        'below-baseline': { trustScore: 65 }, // Below baseline -> No decay
      };

      mockAgentRegistry.getAllConfigs.mockResolvedValue(mockConfigs);
      mockAgentRegistry.atomicUpdateAgentField.mockResolvedValue(undefined);

      await TrustManager.decayTrustScores();

      // Default decay is 0.5
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'high-trust',
        'trustScore',
        97.25, // 98 - (0.5 * 1.5)
        98
      );
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'mid-trust',
        'trustScore',
        87.4, // 88 - (0.5 * 1.2)
        88
      );
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).not.toHaveBeenCalledWith(
        'at-baseline',
        'trustScore',
        expect.any(Number),
        expect.any(Number)
      );
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).not.toHaveBeenCalledWith(
        'below-baseline',
        'trustScore',
        expect.any(Number),
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

      const newScore = await TrustManager.recordSuccess('incomplete-agent', 10);

      expect(newScore).toBe(92); // 90 (DEFAULT_SCORE) + 2 (bump with quality 10)
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
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).not.toHaveBeenCalled();
    });

    it('allows trust update when agent is enabled (explicit true)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'enabled-agent',
        name: 'Enabled Agent',
        trustScore: 80,
        enabled: true,
      });

      const result = await TrustManager.recordSuccess('enabled-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalled();
    });

    it('allows trust update when enabled is undefined (backward compat)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'legacy-agent',
        name: 'Legacy Agent',
        trustScore: 80,
        // enabled not set - should allow updates for backward compatibility
      });

      const result = await TrustManager.recordSuccess('legacy-agent');

      expect(result).toBe(81); // Default bump of 1
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalled();
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
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).not.toHaveBeenCalled();
    });
  });
});
