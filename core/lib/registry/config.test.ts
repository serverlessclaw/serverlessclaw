import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigManager, setDocClient } from './config';

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'mock-table' },
  },
}));

vi.mock('../config/config-versioning', () => ({
  ConfigVersioning: {
    snapshot: vi.fn(),
  },
}));

import { Resource } from 'sst';
import { ConfigVersioning } from '../config/config-versioning';

describe('ConfigManager', () => {
  let docClientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    docClientMock = {
      send: vi.fn().mockResolvedValue({}),
    };
    setDocClient(docClientMock as any);
  });

  it('should safely return undefined when ConfigTable is not linked', async () => {
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue(undefined);
    const value = await ConfigManager.getRawConfig('any_key');
    expect(value).toBeUndefined();
    expect(docClientMock.send).not.toHaveBeenCalled();
  });

  it('should safely return undefined when getTypedConfig is called and ConfigTable is not linked', async () => {
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue(undefined);
    const value = await ConfigManager.getTypedConfig('any_key', 'fallback_value');
    expect(value).toBe('fallback_value');
    expect(docClientMock.send).not.toHaveBeenCalled();
  });

  it('should safely return undefined when saveRawConfig is called and ConfigTable is not linked', async () => {
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue(undefined);
    await expect(ConfigManager.saveRawConfig('any_key', 'value')).resolves.toBeUndefined();
    expect(docClientMock.send).not.toHaveBeenCalled();
  });

  it('should safely return undefined when deleteConfig is called and ConfigTable is not linked', async () => {
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue(undefined);
    await expect(ConfigManager.deleteConfig('any_key')).resolves.toBeUndefined();
    expect(docClientMock.send).not.toHaveBeenCalled();
  });

  it('should handle Resource throwing error during table name resolution', async () => {
    // Mock Resource to throw when accessed
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockImplementation(() => {
      throw new Error('SST Linkage Error');
    });

    const value = await ConfigManager.resolveTableName();
    expect(value).toBeUndefined();
  });
});

describe('ConfigManager.saveRawConfig versioning', () => {
  let docClientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue({ name: 'mock-table' });

    // Mock DynamoDB put
    docClientMock = {
      send: vi.fn().mockResolvedValue({}),
    };
    setDocClient(docClientMock as any);
  });

  it('should snapshot if the new value is different', async () => {
    // Mock the inner getRawConfig to return a specific old value
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue('old_value');

    await ConfigManager.saveRawConfig('test_key', 'new_value');
    expect(ConfigVersioning.snapshot).toHaveBeenCalledWith(
      'test_key',
      'old_value',
      'new_value',
      'system',
      undefined,
      { workspaceId: undefined }
    );
    expect(docClientMock.send).toHaveBeenCalled();
    getRawMock.mockRestore();
  });

  it('should not snapshot if the new value is deeply equal to the old value', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue({ a: 1, b: 2 });
    await ConfigManager.saveRawConfig('test_key', { a: 1, b: 2 });

    expect(ConfigVersioning.snapshot).not.toHaveBeenCalled();
    expect(docClientMock.send).toHaveBeenCalled();
    getRawMock.mockRestore();
  });

  it('should not snapshot if skipVersioning is true', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue('old_value');
    await ConfigManager.saveRawConfig('test_key', 'new_value', { skipVersioning: true });
    expect(ConfigVersioning.snapshot).not.toHaveBeenCalled();
    expect(docClientMock.send).toHaveBeenCalled();
    getRawMock.mockRestore();
  });
});

describe('ConfigManager Caching', () => {
  let docClientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue({ name: 'mock-table' });
    docClientMock = {
      send: vi.fn(),
    };
    setDocClient(docClientMock as any);
    // @ts-expect-error - accessing private field for testing
    ConfigManager.configCache.clear();
  });

  it('should cache getTypedConfig results', async () => {
    docClientMock.send.mockResolvedValueOnce({ Item: { value: 42 } });

    // 1st call - DB hit
    const val1 = await ConfigManager.getTypedConfig('cached_key', 10);
    expect(val1).toBe(42);
    expect(docClientMock.send).toHaveBeenCalledTimes(1);

    // 2nd call - Cache hit
    const val2 = await ConfigManager.getTypedConfig('cached_key', 10);
    expect(val2).toBe(42);
    expect(docClientMock.send).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache on saveRawConfig', async () => {
    docClientMock.send.mockResolvedValueOnce({ Item: { value: 42 } });

    // 1st call - DB hit
    await ConfigManager.getTypedConfig('cached_key', 10);

    // Save - Invalidates
    docClientMock.send.mockResolvedValueOnce({ Item: { value: 42 } }); // getRawConfig for snapshot
    docClientMock.send.mockResolvedValueOnce({}); // putItem
    await ConfigManager.saveRawConfig('cached_key', 100);

    // 3rd call - DB hit again
    docClientMock.send.mockResolvedValueOnce({ Item: { value: 100 } });
    const val3 = await ConfigManager.getTypedConfig('cached_key', 10);
    expect(val3).toBe(100);
    expect(docClientMock.send).toHaveBeenCalledTimes(4); // 1 get, 1 get(snap), 1 put, 1 get
  });
});

describe('ConfigManager.getAgentOverrideConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // @ts-expect-error - accessing private field for testing
    ConfigManager.configCache.clear();
  });

  it('should return agent-specific value when override exists', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValueOnce(42);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(42);
    expect(getRawMock).toHaveBeenCalledWith('agent_config_coder_max_iterations', undefined);
    getRawMock.mockRestore();
  });

  it('should fall back to global config when no agent override exists', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig');
    getRawMock.mockResolvedValueOnce(undefined);
    getRawMock.mockResolvedValueOnce(25);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(25);
    expect(getRawMock).toHaveBeenCalledWith('agent_config_coder_max_iterations', undefined);
    getRawMock.mockRestore();
  });

  it('should fall back to code default when neither agent nor global config exists', async () => {
    const getRawMock = vi.spyOn(ConfigManager, 'getRawConfig').mockResolvedValue(undefined);

    const result = await ConfigManager.getAgentOverrideConfig('coder', 'max_iterations', 10);
    expect(result).toBe(10);
    getRawMock.mockRestore();
  });
});

describe('ConfigManager atomic operations', () => {
  let docClientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue({ name: 'mock-table' });
    docClientMock = {
      send: vi.fn().mockResolvedValue({}),
    };
    setDocClient(docClientMock as any);
  });

  it('should call UpdateCommand with condition for atomicUpdateMapFieldWithCondition', async () => {
    await ConfigManager.atomicUpdateMapFieldWithCondition(
      'key',
      'entity',
      'field',
      'value',
      'expected'
    );

    expect(docClientMock.send).toHaveBeenCalled();
    const command = docClientMock.send.mock.calls[0][0];
    expect(command.input.ConditionExpression).toBe('#val.#id.#field = :expected');
    expect(command.input.ExpressionAttributeValues[':expected']).toBe('expected');
    expect(command.input.ExpressionAttributeValues[':value']).toBe('value');
  });

  it('should retry on ConditionalCheckFailedException in atomicRemoveFromMapList', async () => {
    // 1. First get returns the list
    docClientMock.send.mockResolvedValueOnce({
      Item: { value: { entity: { field: ['item1', 'item2'] } } },
    });
    // 2. First update fails with race condition
    const error = new Error('Race');
    error.name = 'ConditionalCheckFailedException';
    docClientMock.send.mockRejectedValueOnce(error);
    // 3. Second get (retry)
    docClientMock.send.mockResolvedValueOnce({
      Item: { value: { entity: { field: ['item1', 'item2'] } } },
    });
    // 4. Second update succeeds
    docClientMock.send.mockResolvedValueOnce({});

    await ConfigManager.atomicRemoveFromMapList('key', 'entity', 'field', ['item1']);

    expect(docClientMock.send).toHaveBeenCalledTimes(4);
  });

  describe('atomicAppendToList', () => {
    it('should append to list', async () => {
      await ConfigManager.atomicAppendToList('test_list', ['new_item']);

      expect(docClientMock.send).toHaveBeenCalled();
      const command = docClientMock.send.mock.calls[0][0];
      expect(command.input.UpdateExpression).toContain('list_append');
      expect(command.input.ExpressionAttributeValues[':items']).toEqual(['new_item']);
    });

    it('should append to workspace scoped list', async () => {
      await ConfigManager.atomicAppendToList('test_list', ['new_item'], { workspaceId: 'ws-1' });

      expect(docClientMock.send).toHaveBeenCalled();
      const command = docClientMock.send.mock.calls[0][0];
      expect(command.input.Key.key).toBe('WS#ws-1#test_list');
    });

    it('should prevent duplicates if requested', async () => {
      // Mock current list to contain 'existing'
      docClientMock.send.mockResolvedValueOnce({ Item: { value: ['existing'] } });
      // Second send should be the update
      docClientMock.send.mockResolvedValueOnce({});

      await ConfigManager.atomicAppendToList('test_list', ['existing', 'new'], {
        preventDuplicates: true,
      });

      expect(docClientMock.send).toHaveBeenCalledTimes(2);
      const command = docClientMock.send.mock.calls[1][0];
      expect(command.input.ExpressionAttributeValues[':items']).toEqual(['new']);
    });
  });

  describe('atomicRemoveFromList', () => {
    it('should remove items from list with retries', async () => {
      // 1. Get current list
      docClientMock.send.mockResolvedValueOnce({ Item: { value: ['item1', 'item2'] } });
      // 2. Update fails with race
      const error = new Error('Race');
      error.name = 'ConditionalCheckFailedException';
      docClientMock.send.mockRejectedValueOnce(error);
      // 3. Retry get
      docClientMock.send.mockResolvedValueOnce({ Item: { value: ['item1', 'item2'] } });
      // 4. Update succeeds
      docClientMock.send.mockResolvedValueOnce({});

      await ConfigManager.atomicRemoveFromList('test_list', ['item1']);

      expect(docClientMock.send).toHaveBeenCalledTimes(4);
      const command = docClientMock.send.mock.calls[3][0];
      expect(command.input.ExpressionAttributeValues[':newList']).toEqual(['item2']);
      expect(command.input.ConditionExpression).toBe('#val = :oldList');
    });

    it('should use workspaceId correctly', async () => {
      docClientMock.send.mockResolvedValueOnce({ Item: { value: ['item1'] } });
      docClientMock.send.mockResolvedValueOnce({});

      await ConfigManager.atomicRemoveFromList('test_list', ['item1'], { workspaceId: 'ws-1' });

      const getCommand = docClientMock.send.mock.calls[0][0];
      const updateCommand = docClientMock.send.mock.calls[1][0];
      expect(getCommand.input.Key.key).toBe('WS#ws-1#test_list');
      expect(updateCommand.input.Key.key).toBe('WS#ws-1#test_list');
    });
  });
});
