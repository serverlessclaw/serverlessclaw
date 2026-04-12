import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAgentRegistry, mockDefaultDocClient, mockConfigManager } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    getAgentConfig: vi.fn(),
    getAllConfigs: vi.fn().mockResolvedValue({}),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
    atomicUpdateAgentFieldWithCondition: vi.fn().mockResolvedValue(undefined),
  },
  mockDefaultDocClient: {
    send: vi.fn().mockResolvedValue({}),
  },
  mockConfigManager: {
    appendToList: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-table' },
  },
}));

vi.mock('../registry/config', () => ({
  defaultDocClient: mockDefaultDocClient,
  ConfigManager: mockConfigManager,
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

import { TrustManager } from './trust-manager';

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

vi.mock('../registry/config', () => ({
  defaultDocClient: mockDefaultDocClient,
  ConfigManager: mockConfigManager,
}));

vi.mock('sst', () => ({
  Resource: {},
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
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        0,
        10
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
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        100,
        99
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

      // High quality (10/10) -> scaled at 2x bump
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const highQualityScore = await TrustManager.recordSuccess('test-agent', 10);
      expect(highQualityScore).toBeCloseTo(52, 1); // 50 + 2 = 52

      // Low quality (5/10) -> scaled at 1x bump
      mockAgentRegistry.getAgentConfig.mockResolvedValueOnce(getConfig());
      const lowQualityScore = await TrustManager.recordSuccess('test-agent', 5);
      expect(lowQualityScore).toBeCloseTo(51, 1); // 50 + 1 = 51
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
      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'test-agent',
        'trustScore',
        35,
        50
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

      expect(mockAgentRegistry.atomicUpdateAgentFieldWithCondition).toHaveBeenCalledWith(
        'agent-1',
        'trustScore',
        expect.any(Number),
        50
      );

      expect(mockConfigManager.appendToList).toHaveBeenCalled();
    });
  });

  describe('decay', () => {
    it('applies decay to all agents above minimum score with tiered rates', async () => {
      const mockConfigs = {
        'high-trust': { id: 'high-trust', trustScore: 96 },
        'autonomy-trust': { id: 'autonomy-trust', trustScore: 95 },
        'mid-trust': { id: 'mid-trust', trustScore: 85 },
        'low-trust': { id: 'low-trust', trustScore: 70 },
        'below-threshold': { id: 'below-threshold', trustScore: 50 },
      };

      mockAgentRegistry.getAllConfigs = vi.fn().mockResolvedValue(mockConfigs);
      mockAgentRegistry.getRawConfig.mockImplementation(async (_key: string) => {
        return [];
      });

      await TrustManager.decayTrustScores();

      // AUTONOMY_THRESHOLD (>=95): 0.5 * 1.5 = 0.75 decay
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'high-trust',
        'trustScore',
        95.25
      );
      // 95 is exactly at AUTONOMY_THRESHOLD, gets 1.5x decay
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'autonomy-trust',
        'trustScore',
        94.25
      );
      // >= 85: 0.5 * 1.2 = 0.6 decay
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'mid-trust',
        'trustScore',
        84.4
      );
      // Regular decay: 0.5
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'low-trust',
        'trustScore',
        69.5
      );
      expect(mockAgentRegistry.atomicUpdateAgentField).toHaveBeenCalledWith(
        'below-threshold',
        'trustScore',
        49.5
      );
    });
  });
});
