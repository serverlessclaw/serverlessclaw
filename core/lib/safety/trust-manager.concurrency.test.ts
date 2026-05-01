import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustManager } from './trust-manager';

// Mock AgentRegistry
const { mockAgentRegistry } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgentConfig: vi.fn(),
    atomicIncrementTrustScore: vi.fn(),
    getAllConfigs: vi.fn(),
    isBackboneAgent: vi.fn(() => false),
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

describe('TrustManager Concurrency', () => {
  const { mockConfigManager } = vi.hoisted(() => ({
    mockConfigManager: {
      appendToList: vi.fn().mockResolvedValue(undefined),
      atomicUpdateMapEntity: vi.fn(),
    },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mock('../registry/config', () => ({
      ConfigManager: mockConfigManager,
    }));
  });

  it('FIXED: Multiple concurrent decay calls are idempotent', async () => {
    const mockConfigs = {
      'agent-1': { trustScore: 90 },
    };

    mockAgentRegistry.getAllConfigs.mockResolvedValue(mockConfigs);
    mockAgentRegistry.getAgentConfig.mockResolvedValue({ trustScore: 89.38 }); // Fresh score after update

    // Simulate first call succeeding and second call failing due to condition
    mockConfigManager.atomicUpdateMapEntity
      .mockResolvedValueOnce(undefined) // First call succeeds
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' }); // Second call fails

    // Run decay twice concurrently
    await Promise.all([TrustManager.decayTrustScores(), TrustManager.decayTrustScores()]);

    // Should have tried to update twice, but logically it's safe now
    expect(mockConfigManager.atomicUpdateMapEntity).toHaveBeenCalledTimes(2);

    // Check first call parameters
    const today = new Date().toISOString().split('T')[0];
    expect(mockConfigManager.atomicUpdateMapEntity).toHaveBeenCalledWith(
      expect.any(String),
      'agent-1',
      expect.objectContaining({ lastDecayedAt: today }),
      expect.objectContaining({
        conditionExpression: expect.stringContaining('#ld <> :today'),
        increments: { trustScore: -0.62 },
      })
    );
  });
});
