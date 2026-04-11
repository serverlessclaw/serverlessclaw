import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';
import { AgentRegistry } from '../registry';
import { DYNAMO_KEYS } from '../constants';

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    getAgentConfig: vi.fn(),
  },
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
  });

  describe('updateTrustScore', () => {
    it('penalizes an agent and caps at MIN_SCORE', async () => {
      const mockConfigs = {
        'test-agent': { id: 'test-agent', trustScore: 10 },
      };
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce(mockConfigs);
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // history

      const newScore = await TrustManager.recordFailure('test-agent', 'Test Failure', 3); // -5 * 3 = -15

      expect(newScore).toBe(0); // 10 - 15 -> 0
      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        DYNAMO_KEYS.AGENTS_CONFIG,
        expect.objectContaining({
          'test-agent': expect.objectContaining({ trustScore: 0 }),
        }),
        expect.anything()
      );
    });

    it('increments an agent and caps at MAX_SCORE', async () => {
      const mockConfigs = {
        'test-agent': { id: 'test-agent', trustScore: 99 },
      };
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce(mockConfigs);
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // history

      const newScore = await TrustManager.recordSuccess('test-agent');

      expect(newScore).toBe(100); // 99 + 1 -> 100
    });

    it('falls back to backbone defaults if no override exists', async () => {
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce({}); // no overrides
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce({
        id: 'backbone-agent',
        name: 'Backbone',
        trustScore: 80,
        enabled: true,
        systemPrompt: '',
      });
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // history

      const newScore = await TrustManager.recordFailure('backbone-agent', 'First Failure');

      expect(newScore).toBe(75); // 80 - 5 = 75
    });
  });

  describe('history and logging', () => {
    it('persists score history and penalty log', async () => {
      const mockConfigs = { 'agent-1': { trustScore: 50 } };
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce(mockConfigs); // configs
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // penalty log
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // history

      await TrustManager.recordFailure('agent-1', 'Reason X');

      // 1. Save AGENTS_CONFIG
      // 2. Save history
      // 3. Save penalty log
      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        DYNAMO_KEYS.AGENTS_CONFIG,
        expect.anything(),
        expect.anything()
      );
      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        DYNAMO_KEYS.TRUST_SCORE_HISTORY,
        expect.anything(),
        expect.anything()
      );
      expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
        DYNAMO_KEYS.TRUST_PENALTY_LOG,
        expect.anything(),
        expect.anything()
      );

      const historyCall = vi
        .mocked(AgentRegistry.saveRawConfig)
        .mock.calls.find((c) => c[0] === DYNAMO_KEYS.TRUST_SCORE_HISTORY);
      expect(historyCall?.[1]).toContainEqual(
        expect.objectContaining({ agentId: 'agent-1', score: 45 })
      );
    });
  });

  describe('decay', () => {
    it('applies decay to agents above baseline', async () => {
      const mockConfigs = {
        'high-trust': { trustScore: 90 },
        'low-trust': { trustScore: 70 },
        'mid-trust': { trustScore: 70.2 },
      };
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce(mockConfigs);

      await TrustManager.decayTrustScores();

      const saveCall = vi.mocked(AgentRegistry.saveRawConfig).mock.calls[0][1] as any;
      expect(saveCall['high-trust'].trustScore).toBe(89.5);
      expect(saveCall['low-trust'].trustScore).toBe(70);
      expect(saveCall['mid-trust'].trustScore).toBe(70);
    });
  });
});
