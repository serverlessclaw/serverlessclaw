import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import { RETENTION, DYNAMO_KEYS } from '../constants';
import { ConfigManager, setDocClient } from './config';

const { mockDocClient } = vi.hoisted(() => ({
  mockDocClient: {
    send: vi.fn(),
  },
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    ConfigManager: {
      getRawConfig: vi.fn(),
      saveRawConfig: vi.fn().mockResolvedValue(undefined),
      getAgentOverrideConfig: vi.fn(),
      atomicUpdateMapField: vi.fn().mockResolvedValue(undefined),
      atomicUpdateMapEntity: vi.fn().mockResolvedValue(undefined),
      atomicRemoveFromMap: vi.fn().mockResolvedValue(undefined),
      incrementConfig: vi.fn().mockResolvedValue(0),
    },
    defaultDocClient: mockDocClient,
  };
});

// Mock topology discovery to avoid side effects
vi.mock('../utils/topology', () => ({
  discoverSystemTopology: vi.fn(async () => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi.fn(),
    })),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { Resource } from 'sst';

describe('AgentRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setDocClient(mockDocClient as any);
  });

  describe('getRetentionDays', () => {
    it('should return default retention when no override exists', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(undefined);

      const days = await AgentRegistry.getRetentionDays('MESSAGES_DAYS');
      expect(days).toBe(RETENTION.MESSAGES_DAYS);
    });

    it('should return override retention when it exists', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce({ MESSAGES_DAYS: 7 });

      const days = await AgentRegistry.getRetentionDays('MESSAGES_DAYS');
      expect(days).toBe(7);
    });
  });

  describe('getAgentConfig', () => {
    it('should return undefined if config is not found', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(undefined);
      const config = await AgentRegistry.getAgentConfig('non-existent');
      expect(config).toBeUndefined();
    });

    it('should return backbone config merged with DDB config', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { superclaw: { name: 'Custom SuperClaw' } };
        }
        return undefined;
      });

      const config = await AgentRegistry.getAgentConfig('superclaw');
      expect(config).toBeDefined();
      expect(config?.name).toBe('Custom SuperClaw');
      expect(config?.id).toBe('superclaw');
    });

    it('should return only DDB config for non-backbone agents', async () => {
      const customAgent = { id: 'custom', name: 'Custom Agent', tools: [] };
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { custom: customAgent };
        }
        return undefined;
      });

      const config = await AgentRegistry.getAgentConfig('custom');
      expect(config).toEqual(expect.objectContaining(customAgent));
    });

    it('should set default evolutionMode to HITL', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { custom: { id: 'custom', name: 'Custom', tools: [] } };
        }
        return undefined;
      });

      const config = await AgentRegistry.getAgentConfig('custom');
      const { EvolutionMode } = await import('../types/agent');
      expect(config?.evolutionMode).toBe(EvolutionMode.HITL);
    });

    it('should apply tool overrides from batch config', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) {
          return { custom: ['batch_override_tool'] };
        }
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { custom: { id: 'custom', name: 'Custom', tools: ['tool1'] } };
        }
        return undefined;
      });

      const config = await AgentRegistry.getAgentConfig('custom');
      expect(config?.tools).toContain('batch_override_tool');
    });

    it('should prune expired tools with TTL', async () => {
      const now = Date.now();
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) {
          return {
            custom: [
              'permanent_tool',
              { name: 'expired_tool', expiresAt: now - 1000 },
              { name: 'active_tool', expiresAt: now + 1000 },
            ],
          };
        }
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { custom: { id: 'custom', name: 'Custom', tools: [] } };
        }
        return undefined;
      });

      const config = await AgentRegistry.getAgentConfig('custom');
      expect(config?.tools).toContain('permanent_tool');
      expect(config?.tools).toContain('active_tool');
      expect(config?.tools).not.toContain('expired_tool');
    });
  });

  describe('getAllConfigs', () => {
    it('should merge backbone and dynamic configs', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
          return { custom: { id: 'custom', name: 'Custom' } };
        }
        return undefined;
      });

      const all = await AgentRegistry.getAllConfigs();
      expect(all).toHaveProperty('superclaw');
      expect(all).toHaveProperty('custom');
    });
  });

  describe('getFullTopology', () => {
    it('should return topology nodes from DDB', async () => {
      const topology = { nodes: [{ id: 'node1', type: 'bus' as const, label: 'test' }], edges: [] };
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(topology);

      const result = await AgentRegistry.getFullTopology();
      expect(result).toEqual(topology);
    });

    it('should return empty topology if config is empty object', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce({});
      const result = await AgentRegistry.getFullTopology();
      expect(result).toEqual({ nodes: [], edges: [] });
    });
  });

  describe('saveConfig', () => {
    it('should throw error if ConfigTable is not linked', async () => {
      vi.spyOn(Resource as any, 'ConfigTable', 'get').mockReturnValue(undefined);

      const config = { id: 'test', name: 'Test', systemPrompt: 'Prompt', enabled: true };
      await expect(AgentRegistry.saveConfig('test', config)).rejects.toThrow(
        'ConfigTable not linked'
      );
      expect(mockDocClient.send).not.toHaveBeenCalled();
    });

    it('should throw error if name or systemPrompt is missing', async () => {
      await expect(AgentRegistry.saveConfig('id', { id: 'test' } as any)).rejects.toThrow();
    });

    it('should save config to DynamoDB', async () => {
      const config = { id: 'test', name: 'Test', systemPrompt: 'Prompt', enabled: true };

      await AgentRegistry.saveConfig('test', config);
      expect(mockDocClient.send).toHaveBeenCalled();
    });

    it('should implement cognitive lineage with versioning and hashing', async () => {
      const config = { id: 'evolution-bot', name: 'Evolution Bot', systemPrompt: 'Be helpful.' };

      // Mock the atomic field update to simulate versioning
      vi.spyOn(AgentRegistry, 'atomicAddAgentField').mockResolvedValue(1);

      await AgentRegistry.saveConfig('evolution-bot', config);

      // Verify hashing
      expect(ConfigManager.atomicUpdateMapEntity).toHaveBeenCalledWith(
        DYNAMO_KEYS.AGENTS_CONFIG,
        'evolution-bot',
        expect.objectContaining({
          metadata: expect.objectContaining({
            promptHash: expect.any(String),
          }),
        })
      );
    });
  });

  describe('recordToolUsage', () => {
    it('should record tool usage atomically via docClient', async () => {
      mockDocClient.send.mockResolvedValue({});
      await AgentRegistry.recordToolUsage('test_tool', 'test_agent');

      // Called 2 times: global + per-agent
      expect(mockDocClient.send).toHaveBeenCalledTimes(2);
      const firstCall = mockDocClient.send.mock.calls[0][0];
      expect(firstCall.input.UpdateExpression).toContain(
        'SET #val.#tool.#count = if_not_exists(#val.#tool.#count, :zero) + :one'
      );
    });

    it('should handle recordToolUsage calls even if they fail', async () => {
      mockDocClient.send.mockRejectedValue(new Error('DynamoDB Error'));
      await expect(AgentRegistry.recordToolUsage('test_tool', 'test_agent')).resolves.not.toThrow();
    });
  });

  describe('pruneAgentTool', () => {
    it('should prune from batch overrides', async () => {
      vi.mocked(ConfigManager.atomicRemoveFromMap).mockResolvedValueOnce(undefined); // Batch

      const result = await AgentRegistry.pruneAgentTool('agent1', 'tool1');

      expect(result).toBe(true);
      expect(ConfigManager.atomicRemoveFromMap).toHaveBeenCalledWith(
        DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
        'agent1',
        ['tool1'],
        undefined
      );
    });

    it('should return false if batch pruning fails', async () => {
      vi.mocked(ConfigManager.atomicRemoveFromMap).mockImplementationOnce(() => {
        throw new Error('Batch fail');
      });

      const result = await AgentRegistry.pruneAgentTool('agent1', 'tool1');

      expect(result).toBe(false);
    });
  });
});
