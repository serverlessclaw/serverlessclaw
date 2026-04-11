import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import { RETENTION, DYNAMO_KEYS } from '../constants';
import { ConfigManager, setDocClient } from './config';
import { Resource } from 'sst';

// Mock dependencies
vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

const { mockDocClient } = vi.hoisted(() => ({
  mockDocClient: {
    send: vi.fn(),
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

describe('AgentRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDocClient(mockDocClient as any);
    // Reset Resource mock to default
    (Resource as any).ConfigTable = { name: 'test-config-table' };
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
        if (key === 'custom_tools') {
          return [
            'permanent_tool',
            { name: 'expired_tool', expiresAt: now - 1000 },
            { name: 'active_tool', expiresAt: now + 1000 },
          ];
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

  describe('getInfraConfig', () => {
    it('should return topology nodes from DDB', async () => {
      const nodes = [{ id: 'node1', type: 'bus' }];
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(nodes);

      const result = await AgentRegistry.getInfraConfig();
      expect(result).toEqual(nodes);
    });

    it('should return empty array if config is not an array', async () => {
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce({});
      const result = await AgentRegistry.getInfraConfig();
      expect(result).toEqual([]);
    });
  });

  describe('saveConfig', () => {
    it('should warn and return if ConfigTable is not linked', async () => {
      (Resource as any).ConfigTable = undefined;

      const config = { id: 'test', name: 'Test', systemPrompt: 'Prompt', enabled: true };
      await AgentRegistry.saveConfig('test', config);
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
  });

  describe('recordToolUsage', () => {
    it('should update tool usage in DynamoDB', async () => {
      await AgentRegistry.recordToolUsage('test_tool', 'test_agent');
      // Called twice: once for global, once for per-agent
      expect(mockDocClient.send).toHaveBeenCalledTimes(2);
    });

    it('should handle missing ConfigTable in recordToolUsage', async () => {
      (Resource as any).ConfigTable = undefined;
      await AgentRegistry.recordToolUsage('test_tool', 'test_agent');
      expect(mockDocClient.send).not.toHaveBeenCalled();
    });
  });
});
