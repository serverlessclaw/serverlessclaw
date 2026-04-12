import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';
import { DYNAMO_KEYS } from '../constants';

const { mockAgentRegistry } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    getAgentConfig: vi.fn(),
    getAllConfigs: vi.fn().mockResolvedValue({}),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../registry', () => ({
  AgentRegistry: mockAgentRegistry,
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('TrustManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentRegistry.getRawConfig.mockResolvedValue([]);
    mockAgentRegistry.getAgentConfig.mockResolvedValue(undefined);
    mockAgentRegistry.saveRawConfig.mockResolvedValue(undefined);
    mockAgentRegistry.atomicUpdateAgentField.mockResolvedValue(undefined);
  });

  describe('updateTrustScore', () => {
    it('penalizes an agent and caps at MIN_SCORE', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'test-agent',
        name: 'Test',
        trustScore: 10,
        enabled: true,
        systemPrompt: '',
      });

      const newScore = await TrustManager.recordFailure('test-agent', 'Test Failure', 3); // -5 * 3 = -15

      expect(newScore).toBe(0); // 10 - 15 -> 0
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        0
      );
    });

    it('increments an agent and caps at MAX_SCORE', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'test-agent',
        name: 'Test',
        trustScore: 99,
        enabled: true,
        systemPrompt: '',
      });

      const newScore = await TrustManager.recordSuccess('test-agent');

      expect(newScore).toBe(100); // 99 + 1 -> 100
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        100
      );
    });

    it('applies quality weighting to success bumps', async () => {
      const getConfig = () => ({
        id: 'test-agent',
        name: 'Test',
        trustScore: 50,
        enabled: true,
        systemPrompt: '',
      });

      // High quality (10/10) -> 1.33x bump
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const highQualityScore = await TrustManager.recordSuccess('test-agent', 10);
      expect(highQualityScore).toBeCloseTo(51.33, 1);

      // Low quality (5/10) -> 0.66x bump
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const lowQualityScore = await TrustManager.recordSuccess('test-agent', 5);
      expect(lowQualityScore).toBeCloseTo(50.66, 1);
    });

    it('penalizes based on anomaly severity (batched)', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'test-agent',
        name: 'Test',
        trustScore: 50,
        enabled: true,
        systemPrompt: '',
      });
      const { AnomalyType, AnomalySeverity } = await import('../types/metrics');

      const criticalScore = await TrustManager.recordAnomalies('test-agent', [
        {
          id: 'a1',
          type: AnomalyType.COGNITIVE_LOOP,
          severity: AnomalySeverity.CRITICAL,
          agentId: 'test-agent',
          detectedAt: Date.now(),
          description: 'Stuck in loop',
          triggerMetrics: {},
          suggestion: '',
        },
      ]);
      expect(criticalScore).toBe(35); // 50 - 15 = 35
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        35
      );
    });
  });

  describe('history and logging', () => {
    it('persists score history and penalty log', async () => {
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce({
        id: 'agent-1',
        name: 'Agent 1',
        trustScore: 50,
        enabled: true,
        systemPrompt: '',
      });
      mockAgentRegistry.getRawConfig.mockResolvedValue([]); // history

      await TrustManager.recordFailure('agent-1', 'Reason X');

      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'agent-1',
        'trustScore',
        expect.any(Number)
      );

      const agentHistoryKey = `${DYNAMO_KEYS.REPUTATION_PREFIX}HISTORY#agent-1`;
      expect(mockAgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        agentHistoryKey,
        expect.anything(),
        expect.anything()
      );

      expect(mockAgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        DYNAMO_KEYS.TRUST_PENALTY_LOG,
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('decay', () => {
    it('applies decay to agents above baseline', async () => {
      const mockConfigs = {
        'high-trust': { id: 'high-trust', trustScore: 90 },
        'low-trust': { id: 'low-trust', trustScore: 70 },
        'mid-trust': { id: 'mid-trust', trustScore: 70.2 },
      };

      mockAgentRegistry.getAllConfigs = vi.fn().mockResolvedValue(mockConfigs);
      mockAgentRegistry.getRawConfig.mockImplementation(async (_key: string) => {
        return [];
      });

      await TrustManager.decayTrustScores();

      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'high-trust',
        'trustScore',
        89.5
      );
      expect(mockAgentRegistry.atomicUpdateAgentField).not.toHaveBeenCalledWith(
        'low-trust',
        'trustScore',
        expect.anything()
      );
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'mid-trust',
        'trustScore',
        70
      );
    });
  });
});
