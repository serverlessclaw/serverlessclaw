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
    description?: string,
    options?: { workspaceId?: string; orgId?: string }
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
        ((await ConfigManager.getRawConfig(versionsKey(key), options)) as ConfigVersion[]) ?? [];
      const updated = [...existing, version].slice(-MAX_VERSIONS_PER_KEY);
      await ConfigManager.saveRawConfig(versionsKey(key), updated, {
        author: 'system:versioning',
        skipVersioning: true,
        workspaceId: options?.workspaceId,
        orgId: options?.orgId,
      });
    } catch (e) {
      logger.warn(`Failed to snapshot config version for ${key}:`, e);
    }
  }

  static async getVersionHistory(
    key: string,
    options?: { limit?: number; workspaceId?: string; orgId?: string }
  ): Promise<ConfigVersion[]> {
    const versions =
      ((await ConfigManager.getRawConfig(versionsKey(key), {
        workspaceId: options?.workspaceId,
        orgId: options?.orgId,
      })) as ConfigVersion[]) ?? [];
    if (options?.limit) return versions.slice(-options.limit);
    return versions;
  }

  static async rollback(
    key: string,
    versionId: string,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<void> {
    const versions = await this.getVersionHistory(key, options);
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) {
      throw new Error(`Config version ${versionId} not found for key ${key}`);
    }

    const currentValue = await ConfigManager.getRawConfig(key, options);

    await this.snapshot(
      key,
      currentValue,
      target.oldValue,
      'system:rollback',
      `Rollback to ${versionId}`,
      options
    );
    await ConfigManager.saveRawConfig(key, target.oldValue, {
      author: 'system:rollback',
      skipVersioning: true,
      workspaceId: options?.workspaceId,
      orgId: options?.orgId,
    });

    logger.info(`Config ${key} rolled back to version ${versionId}`);
  }
}
