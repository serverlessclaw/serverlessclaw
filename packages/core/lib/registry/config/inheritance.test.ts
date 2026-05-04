import { describe, it, expect } from 'vitest';
import { ConfigManager } from '../config';
import { ConfigManagerMap } from './map';
import { ConfigManagerMapCollections } from './map-collections';
import { ConfigManagerMapAtomic } from './map-atomic';
import { ConfigManagerList } from './list';
import { ConfigManagerBase } from './base';

describe('ConfigManager Inheritance Chain', () => {
  it('should have the correct inheritance hierarchy', () => {
    // ConfigManager -> ConfigManagerMap -> ConfigManagerMapCollections -> ConfigManagerMapAtomic -> ConfigManagerList -> ConfigManagerBase

    expect(ConfigManager.prototype).toBeInstanceOf(ConfigManagerMap);
    expect(ConfigManagerMap.prototype).toBeInstanceOf(ConfigManagerMapCollections);
    expect(ConfigManagerMapCollections.prototype).toBeInstanceOf(ConfigManagerMapAtomic);
    expect(ConfigManagerMapAtomic.prototype).toBeInstanceOf(ConfigManagerList);
    expect(ConfigManagerList.prototype).toBeInstanceOf(ConfigManagerBase);
  });

  it('should have access to methods from all levels of the hierarchy', () => {
    // Base level
    expect(typeof ConfigManager.getRawConfig).toBe('function');

    // List level
    expect(typeof ConfigManager.atomicAppendToList).toBe('function');

    // Map Atomic level
    expect(typeof ConfigManager.atomicIncrementMapField).toBe('function');

    // Map Collections level
    expect(typeof ConfigManager.atomicAppendToMapList).toBe('function');

    // Map level
    expect(typeof ConfigManager.getMapEntity).toBe('function');

    // Top level (ConfigManager)
    expect(typeof ConfigManager.getAgentOverrideConfig).toBe('function');
  });
});
