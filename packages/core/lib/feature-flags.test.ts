import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeatureFlags, FeatureFlag } from './feature-flags';

vi.mock('./registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(true),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    deleteConfig: vi.fn().mockResolvedValue(undefined),
    atomicAppendToList: vi.fn().mockResolvedValue(undefined),
    atomicRemoveFromList: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('FeatureFlags', () => {
  let mockConfigManager: any;

  beforeEach(async () => {
    const configModule = await import('./registry/config');
    mockConfigManager = vi.mocked(configModule.ConfigManager);
    vi.clearAllMocks();
    mockConfigManager.getTypedConfig.mockResolvedValue(true);
    mockConfigManager.getRawConfig.mockResolvedValue(undefined);
    mockConfigManager.saveRawConfig.mockResolvedValue(undefined);
    mockConfigManager.atomicAppendToList.mockResolvedValue(undefined);
    mockConfigManager.atomicRemoveFromList.mockResolvedValue(undefined);
    FeatureFlags.clearCache();
  });

  afterEach(() => {
    FeatureFlags.clearCache();
  });

  describe('isEnabled', () => {
    it('should return false when global feature flags are disabled', async () => {
      mockConfigManager.getTypedConfig.mockResolvedValueOnce(false);

      const result = await FeatureFlags.isEnabled('test_flag');
      expect(result).toBe(false);
    });

    it('should return false when flag does not exist', async () => {
      const result = await FeatureFlags.isEnabled('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when flag is disabled', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: false,
        rolloutPercent: 100,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValueOnce(flag);

      const result = await FeatureFlags.isEnabled('test_flag');
      expect(result).toBe(false);
    });

    it('should return true when flag is enabled with 100% rollout', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValueOnce(flag);

      const result = await FeatureFlags.isEnabled('test_flag');
      expect(result).toBe(true);
    });

    it('should return false when flag has 0% rollout', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: true,
        rolloutPercent: 0,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValueOnce(flag);

      const result = await FeatureFlags.isEnabled('test_flag');
      expect(result).toBe(false);
    });

    it('should evaluate rolloutPercent deterministically', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: true,
        rolloutPercent: 50,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValue(flag);

      const result1 = await FeatureFlags.isEnabled('test_flag', 'agent_1');
      const result2 = await FeatureFlags.isEnabled('test_flag', 'agent_1');
      expect(result1).toBe(result2);
    });

    it('should respect targetAgents filter', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: true,
        rolloutPercent: 100,
        targetAgents: ['coder', 'strategic-planner'],
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValue(flag);

      expect(await FeatureFlags.isEnabled('test_flag', 'coder')).toBe(true);
      expect(await FeatureFlags.isEnabled('test_flag', 'stranger')).toBe(false);
    });

    it('should return false when agentId not provided but targetAgents specified', async () => {
      const flag: FeatureFlag = {
        name: 'test_flag',
        enabled: true,
        rolloutPercent: 100,
        targetAgents: ['coder'],
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValue(flag);

      expect(await FeatureFlags.isEnabled('test_flag')).toBe(false);
    });

    it('should cache flag results for 60 seconds', async () => {
      const flag: FeatureFlag = {
        name: 'cached_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValueOnce(flag);

      await FeatureFlags.isEnabled('cached_flag');
      await FeatureFlags.isEnabled('cached_flag');

      expect(mockConfigManager.getRawConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe('setFlag', () => {
    it('should save a feature flag to ConfigManager and update the list', async () => {
      const flag: FeatureFlag = {
        name: 'new_flag',
        enabled: true,
        rolloutPercent: 25,
        description: 'A new feature',
      };

      await FeatureFlags.setFlag(flag);

      expect(mockConfigManager.saveRawConfig).toHaveBeenCalledTimes(1);
      const [key1, value1, options1] = mockConfigManager.saveRawConfig.mock.calls[0];
      expect(key1).toBe('feature_flag_new_flag');
      expect(value1).toMatchObject({ name: 'new_flag', enabled: true, rolloutPercent: 25 });
      expect(options1.skipVersioning).toBe(true);

      expect(mockConfigManager.atomicAppendToList).toHaveBeenCalledWith(
        'feature_flags_list',
        ['new_flag'],
        { preventDuplicates: true, workspaceId: undefined }
      );
    });

    it('should clear the cache when flag is updated', async () => {
      const flag: FeatureFlag = {
        name: 'cached_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Test',
      };
      mockConfigManager.getRawConfig.mockResolvedValueOnce(flag);

      await FeatureFlags.isEnabled('cached_flag');
      expect(mockConfigManager.getRawConfig).toHaveBeenCalledTimes(1);

      await FeatureFlags.setFlag({ ...flag, enabled: false });

      mockConfigManager.getRawConfig.mockResolvedValueOnce({ ...flag, enabled: false });
      const result = await FeatureFlags.isEnabled('cached_flag');

      expect(result).toBe(false);
    });
  });

  describe('pruneStaleFlags', () => {
    it('should return 0 when no flags exist', async () => {
      mockConfigManager.getTypedConfig.mockResolvedValueOnce([]);

      const result = await FeatureFlags.pruneStaleFlags(30);
      expect(result).toBe(0);
    });

    it('should prune flags with expired expiresAt', async () => {
      const expiredFlag: FeatureFlag = {
        name: 'expired_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Expired flag',
        expiresAt: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
      };

      mockConfigManager.getTypedConfig.mockResolvedValueOnce(['expired_flag']); // listFlags call
      mockConfigManager.getRawConfig.mockResolvedValueOnce(expiredFlag);
      mockConfigManager.deleteConfig.mockResolvedValueOnce(undefined);

      const result = await FeatureFlags.pruneStaleFlags(30);
      expect(result).toBe(1);
      expect(mockConfigManager.deleteConfig).toHaveBeenCalledWith('feature_flag_expired_flag', {
        workspaceId: undefined,
      });
      expect(mockConfigManager.atomicRemoveFromList).toHaveBeenCalledWith(
        'feature_flags_list',
        ['expired_flag'],
        { workspaceId: undefined }
      );
    });

    it('should prune flags based on age threshold when no expiresAt', async () => {
      const oldFlag: FeatureFlag = {
        name: 'old_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Old flag',
        createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
      };

      mockConfigManager.getTypedConfig.mockResolvedValueOnce(['old_flag']); // listFlags call
      mockConfigManager.getRawConfig.mockResolvedValueOnce(oldFlag);
      mockConfigManager.deleteConfig.mockResolvedValueOnce(undefined);

      const result = await FeatureFlags.pruneStaleFlags(30);
      expect(result).toBe(1);
      expect(mockConfigManager.atomicRemoveFromList).toHaveBeenCalledWith(
        'feature_flags_list',
        ['old_flag'],
        { workspaceId: undefined }
      );
    });

    it('should not prune flags within threshold', async () => {
      const freshFlag: FeatureFlag = {
        name: 'fresh_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Fresh flag',
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
      };

      mockConfigManager.getTypedConfig.mockResolvedValueOnce(['fresh_flag']); // listFlags call
      mockConfigManager.getRawConfig.mockResolvedValueOnce(freshFlag);

      const result = await FeatureFlags.pruneStaleFlags(30);
      expect(result).toBe(0);
      expect(mockConfigManager.deleteConfig).not.toHaveBeenCalled();
      expect(mockConfigManager.atomicRemoveFromList).not.toHaveBeenCalled();
    });

    it('should update feature_flags_list after pruning', async () => {
      const staleFlag: FeatureFlag = {
        name: 'stale_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Stale flag',
        expiresAt: Math.floor(Date.now() / 1000) - 86400,
      };
      const freshFlag: FeatureFlag = {
        name: 'fresh_flag',
        enabled: true,
        rolloutPercent: 100,
        description: 'Fresh flag',
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
      };

      mockConfigManager.getTypedConfig.mockResolvedValueOnce(['stale_flag', 'fresh_flag']); // listFlags call

      mockConfigManager.getRawConfig
        .mockResolvedValueOnce(staleFlag)
        .mockResolvedValueOnce(freshFlag);

      mockConfigManager.deleteConfig.mockResolvedValueOnce(undefined);

      const result = await FeatureFlags.pruneStaleFlags(30);
      expect(result).toBe(1);

      // Verify list was updated via atomicRemoveFromList
      expect(mockConfigManager.atomicRemoveFromList).toHaveBeenCalledWith(
        'feature_flags_list',
        ['stale_flag'],
        { workspaceId: undefined }
      );
    });
  });
});
