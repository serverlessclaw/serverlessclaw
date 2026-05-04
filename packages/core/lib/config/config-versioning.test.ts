import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigVersioning } from './config-versioning';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    getTypedConfig: vi.fn(),
  },
}));

describe('ConfigVersioning', () => {
  let mockConfigManager: any;

  beforeEach(async () => {
    const configModule = await import('../registry/config');
    mockConfigManager = vi.mocked(configModule.ConfigManager);
    vi.resetAllMocks();
    mockConfigManager.getRawConfig.mockResolvedValue(undefined);
    mockConfigManager.saveRawConfig.mockResolvedValue(undefined);
  });

  describe('snapshot', () => {
    it('should save a version entry to the versions list', async () => {
      mockConfigManager.getRawConfig.mockResolvedValueOnce(undefined);

      await ConfigVersioning.snapshot('test_key', 10, 20, 'admin', 'Increased threshold');

      expect(mockConfigManager.saveRawConfig).toHaveBeenCalledTimes(1);
      const [key, versions, options] = mockConfigManager.saveRawConfig.mock.calls[0];
      expect(key).toBe('config_versions_test_key');
      expect(versions).toHaveLength(1);
      expect((versions as Record<string, unknown>[])[0]).toMatchObject({
        key: 'test_key',
        oldValue: 10,
        newValue: 20,
        author: 'admin',
        description: 'Increased threshold',
      });
      expect((versions as Record<string, unknown>[])[0].versionId).toMatch(
        /^test_key_\d+_[a-z0-9]{4}$/
      );
      expect(options.skipVersioning).toBe(true);
    });

    it('should append to existing versions and cap at 20', async () => {
      const existing = Array.from({ length: 20 }, (_, i) => ({
        versionId: `test_key_${i}_xxxx`,
        key: 'test_key',
        createdAt: i,
        oldValue: i,
        newValue: i + 1,
        author: 'system',
      }));
      mockConfigManager.getRawConfig.mockResolvedValueOnce(existing);

      await ConfigVersioning.snapshot('test_key', 99, 100, 'admin');

      const versions = mockConfigManager.saveRawConfig.mock.calls[0][1] as Record<
        string,
        unknown
      >[];
      expect(versions).toHaveLength(20);
      expect(versions[0].oldValue).toBe(1);
      expect(versions[19].oldValue).toBe(99);
    });

    it('should not throw on save failure', async () => {
      mockConfigManager.getRawConfig.mockRejectedValueOnce(new Error('DDB down'));

      await expect(ConfigVersioning.snapshot('test_key', 1, 2, 'system')).resolves.toBeUndefined();
    });
  });

  describe('getVersionHistory', () => {
    it('should return all versions for a key', async () => {
      const versions = [
        {
          versionId: 'test_key_1_xxxx',
          key: 'test_key',
          createdAt: 1,
          oldValue: 1,
          newValue: 2,
          author: 'system',
        },
        {
          versionId: 'test_key_2_yyyy',
          key: 'test_key',
          createdAt: 2,
          oldValue: 2,
          newValue: 3,
          author: 'admin',
        },
      ];
      mockConfigManager.getRawConfig.mockResolvedValueOnce(versions);

      const result = await ConfigVersioning.getVersionHistory('test_key');
      expect(result).toHaveLength(2);
      expect(result[0].author).toBe('system');
    });

    it('should return empty array when no versions exist', async () => {
      mockConfigManager.getRawConfig.mockResolvedValueOnce(undefined);
      const result = await ConfigVersioning.getVersionHistory('unknown_key');
      expect(result).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      const versions = Array.from({ length: 10 }, (_, i) => ({
        versionId: `v_${i}`,
        key: 'test',
        createdAt: i,
        oldValue: i,
        newValue: i + 1,
        author: 'system',
      }));
      mockConfigManager.getRawConfig.mockResolvedValueOnce(versions);

      const result = await ConfigVersioning.getVersionHistory('test', { limit: 3 });
      expect(result).toHaveLength(3);
      expect(result[0].versionId).toBe('v_7');
    });
  });

  describe('rollback', () => {
    it('should snapshot current value and restore target', async () => {
      const versions = [
        {
          versionId: 'test_key_1_xxxx',
          key: 'test_key',
          createdAt: 1,
          oldValue: 10,
          newValue: 20,
          author: 'admin',
        },
      ];
      mockConfigManager.getRawConfig
        .mockResolvedValueOnce(versions)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce([{}]);

      await ConfigVersioning.rollback('test_key', 'test_key_1_xxxx');

      expect(mockConfigManager.getRawConfig).toHaveBeenCalledTimes(3);
      expect(mockConfigManager.saveRawConfig).toHaveBeenCalledTimes(2);

      const snapshotSave = mockConfigManager.saveRawConfig.mock.calls[0];
      expect(snapshotSave[2].author).toBe('system:versioning');

      const restore = mockConfigManager.saveRawConfig.mock.calls[1];
      expect(restore[1]).toBe(10);
      expect(restore[2].author).toBe('system:rollback');
    });

    it('should throw when version not found', async () => {
      mockConfigManager.getRawConfig.mockResolvedValueOnce([]);

      await expect(ConfigVersioning.rollback('test_key', 'nonexistent')).rejects.toThrow(
        'Config version nonexistent not found for key test_key'
      );
    });
  });
});
