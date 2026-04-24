/**
 * @module SafetyConfigManager Tests
 * @description Tests for safety policy management including DDB fetching,
 * caching, cache invalidation, and fallback to defaults.\n */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyConfigManager } from './safety-config-manager';
import { DEFAULT_POLICIES } from './policy-defaults';
import { SafetyTier } from '../types/agent';
import { ConfigManager } from '../registry/config';

// Mock ConfigManager
vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn(),
    atomicUpdateMapEntity: vi.fn(),
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('SafetyConfigManager', () => {
  const mockGetRawConfig = ConfigManager.getRawConfig as any;
  const mockSaveRawConfig = ConfigManager.saveRawConfig as any;
  const mockAtomicUpdate = ConfigManager.atomicUpdateMapEntity as any;

  beforeEach(() => {
    vi.clearAllMocks();
    SafetyConfigManager.clearCache();
  });

  describe('getPolicies', () => {
    it('returns DDB policies merged with defaults', async () => {
      mockGetRawConfig.mockResolvedValue({
        [SafetyTier.PROD]: {
          ...DEFAULT_POLICIES[SafetyTier.PROD],
          maxDeploymentsPerDay: 5,
        },
      });

      const policies = await SafetyConfigManager.getPolicies();

      expect(policies[SafetyTier.PROD].maxDeploymentsPerDay).toBe(5);
      expect(policies[SafetyTier.LOCAL]).toEqual(DEFAULT_POLICIES[SafetyTier.LOCAL]);
    });

    it('returns cached policies on subsequent calls within TTL', async () => {
      mockGetRawConfig.mockResolvedValue(DEFAULT_POLICIES);

      await SafetyConfigManager.getPolicies();
      await SafetyConfigManager.getPolicies();

      expect(mockGetRawConfig).toHaveBeenCalledTimes(1);
    });

    it('falls back to defaults if DDB returns nothing', async () => {
      mockGetRawConfig.mockResolvedValue(null);

      const policies = await SafetyConfigManager.getPolicies();

      expect(policies).toEqual(DEFAULT_POLICIES);
    });

    it('ignores invalid tier keys in DDB data', async () => {
      mockGetRawConfig.mockResolvedValue({
        invalid_tier: { requireCodeApproval: true },
      });

      const policies = await SafetyConfigManager.getPolicies();

      expect(policies[SafetyTier.PROD]).toEqual(DEFAULT_POLICIES[SafetyTier.PROD]);
      expect(policies[SafetyTier.LOCAL]).toEqual(DEFAULT_POLICIES[SafetyTier.LOCAL]);
    });
  });

  describe('getPolicy', () => {
    it('returns policy for specific tier', async () => {
      mockGetRawConfig.mockResolvedValue(DEFAULT_POLICIES);

      const policy = await SafetyConfigManager.getPolicy(SafetyTier.PROD);

      expect(policy.tier).toBe(SafetyTier.PROD);
    });

    it('falls back to default for missing tier', async () => {
      mockGetRawConfig.mockResolvedValue({});

      const policy = await SafetyConfigManager.getPolicy(SafetyTier.PROD);

      expect(policy).toEqual(DEFAULT_POLICIES[SafetyTier.PROD]);
    });
  });

  describe('savePolicies', () => {
    it('calls atomicUpdateMapEntity for each tier and saves', async () => {
      mockAtomicUpdate.mockResolvedValue(undefined);

      await SafetyConfigManager.savePolicies({
        [SafetyTier.PROD]: { maxDeploymentsPerDay: 10 },
      });

      expect(mockAtomicUpdate).toHaveBeenCalledTimes(1);
      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        'safety_policies',
        SafetyTier.PROD,
        {
          maxDeploymentsPerDay: 10,
        },
        { workspaceId: undefined }
      );
    });

    it('invalidates cache after save', async () => {
      mockGetRawConfig.mockResolvedValue(DEFAULT_POLICIES);
      mockSaveRawConfig.mockResolvedValue(undefined);

      await SafetyConfigManager.getPolicies();
      await SafetyConfigManager.savePolicies({
        [SafetyTier.PROD]: { maxDeploymentsPerDay: 10 },
      });
      await SafetyConfigManager.getPolicies();

      expect(mockGetRawConfig).toHaveBeenCalledTimes(2);
    });

    it('handles high-concurrency contention via atomicUpdateMapEntity', async () => {
      mockAtomicUpdate.mockResolvedValue(undefined);

      // Simulate 10 concurrent policy updates
      const updates = Array.from({ length: 10 }).map((_, i) =>
        SafetyConfigManager.savePolicies({
          [SafetyTier.PROD]: { maxDeploymentsPerDay: i },
        })
      );

      await Promise.all(updates);

      // Verify that atomicUpdateMapEntity was called 10 times
      // Principle 13 ensures each of these is independent and atomic
      expect(mockAtomicUpdate).toHaveBeenCalledTimes(10);
    });
  });
});
