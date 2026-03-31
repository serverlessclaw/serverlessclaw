import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager, setDocClient } from './config';

vi.mock('sst', () => ({
  Resource: {},
}));

vi.mock('../config/config-versioning', () => ({
  ConfigVersioning: {
    snapshot: vi.fn(),
  },
}));

import { Resource } from 'sst';
import { ConfigVersioning } from '../config/config-versioning';

describe('ConfigManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should safely return undefined when ConfigTable is not linked', async () => {
    // Should not throw TypeError when checking 'ConfigTable' in Resource
    const value = await ConfigManager.getRawConfig('any_key');
    expect(value).toBeUndefined();
  });

  it('should safely return undefined when getTypedConfig is called and ConfigTable is not linked', async () => {
    const value = await ConfigManager.getTypedConfig('any_key', 'fallback_value');
    expect(value).toBe('fallback_value');
  });

  it('should safely return undefined when saveRawConfig is called and ConfigTable is not linked', async () => {
    await expect(ConfigManager.saveRawConfig('any_key', 'value')).resolves.toBeUndefined();
  });
});

describe('ConfigManager.saveRawConfig versioning', () => {
  let docClientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (Resource as any).ConfigTable = { name: 'mock-table' };

    // Mock the inner getRawConfig to return a specific old value
    vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue('old_value');

    // Mock DynamoDB put
    docClientMock = {
      send: vi.fn().mockResolvedValue({}),
    };
    setDocClient(docClientMock as any);
  });

  afterEach(() => {
    delete (Resource as any).ConfigTable;
  });

  it('should snapshot if the new value is different', async () => {
    await ConfigManager.saveRawConfig('test_key', 'new_value');
    expect(ConfigVersioning.snapshot).toHaveBeenCalledWith(
      'test_key',
      'old_value',
      'new_value',
      'system',
      undefined
    );
    expect(docClientMock.send).toHaveBeenCalled();
  });

  it('should not snapshot if the new value is deeply equal to the old value', async () => {
    vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue({ a: 1, b: 2 });
    await ConfigManager.saveRawConfig('test_key', { a: 1, b: 2 });

    expect(ConfigVersioning.snapshot).not.toHaveBeenCalled();
    expect(docClientMock.send).toHaveBeenCalled();
  });

  it('should not snapshot if skipVersioning is true', async () => {
    await ConfigManager.saveRawConfig('test_key', 'new_value', { skipVersioning: true });
    expect(ConfigVersioning.snapshot).not.toHaveBeenCalled();
    expect(docClientMock.send).toHaveBeenCalled();
  });
});

describe('ConfigManager.getAgentOverrideConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return agent-specific value when override exists', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValueOnce(42);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(42);
    expect(getRawMock).toHaveBeenCalledWith('agent_config_coder_max_iterations');
  });

  it('should fall back to global config when no agent override exists', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig');
    getRawMock.mockResolvedValueOnce(undefined);
    getRawMock.mockResolvedValueOnce(25);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(25);
    expect(getRawMock).toHaveBeenCalledTimes(2);
  });

  it('should fall back to code default when neither agent nor global config exists', async () => {
    vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue(undefined);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(10);
  });
});
