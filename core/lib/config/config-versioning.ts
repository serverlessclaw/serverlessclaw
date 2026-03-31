import { ConfigManager } from '../registry/config';
import { logger } from '../logger';

export interface ConfigVersion {
  versionId: string;
  key: string;
  createdAt: number;
  oldValue: unknown;
  newValue: unknown;
  author: string;
  description?: string;
}

const MAX_VERSIONS_PER_KEY = 20;

function generateVersionId(key: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  return `${key}_${ts}_${rand}`;
}

function versionsKey(key: string): string {
  return `config_versions_${key}`;
}

export class ConfigVersioning {
  static async snapshot(
    key: string,
    oldValue: unknown,
    newValue: unknown,
    author: string,
    description?: string
  ): Promise<void> {
    const version: ConfigVersion = {
      versionId: generateVersionId(key),
      key,
      createdAt: Date.now(),
      oldValue,
      newValue,
      author,
      description,
    };

    try {
      const existing =
        ((await ConfigManager.getRawConfig(versionsKey(key))) as ConfigVersion[]) ?? [];
      const updated = [...existing, version].slice(-MAX_VERSIONS_PER_KEY);
      await ConfigManager.saveRawConfig(versionsKey(key), updated, {
        author: 'system:versioning',
        skipVersioning: true,
      });
    } catch (e) {
      logger.warn(`Failed to snapshot config version for ${key}:`, e);
    }
  }

  static async getVersionHistory(key: string, limit?: number): Promise<ConfigVersion[]> {
    const versions =
      ((await ConfigManager.getRawConfig(versionsKey(key))) as ConfigVersion[]) ?? [];
    if (limit) return versions.slice(-limit);
    return versions;
  }

  static async rollback(key: string, versionId: string): Promise<void> {
    const versions = await this.getVersionHistory(key);
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) {
      throw new Error(`Config version ${versionId} not found for key ${key}`);
    }

    const currentValue = await ConfigManager.getRawConfig(key);

    await this.snapshot(
      key,
      currentValue,
      target.oldValue,
      'system:rollback',
      `Rollback to ${versionId}`
    );
    await ConfigManager.saveRawConfig(key, target.oldValue, {
      author: 'system:rollback',
      skipVersioning: true,
    });

    logger.info(`Config ${key} rolled back to version ${versionId}`);
  }
}
