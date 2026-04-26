import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import { ConfigManager } from './config';
import { DYNAMO_KEYS } from '../constants';

const { mockDocClient } = vi.hoisted(() => ({
  mockDocClient: {
    send: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('./config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    atomicUpdateMapField: vi.fn().mockResolvedValue(undefined),
    atomicUpdateMapEntity: vi.fn().mockResolvedValue(undefined),
    atomicRemoveFromMap: vi.fn().mockResolvedValue(undefined),
  },
  defaultDocClient: mockDocClient,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi.fn(),
    })),
  },
  DeleteCommand: vi.fn(),
}));

vi.mock('../utils/topology', () => ({
  discoverSystemTopology: vi.fn(async () => ({})),
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'mock-config-table' },
  },
}));

// Tests fixed: Tool names no longer have workspace prefixes (they're simple names like 'toolA')
// Workspace scoping is handled by workspaceId parameter, not tool name prefixes
describe('AgentRegistry Pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prune unused tools from workspace-scoped agents', async () => {
    const now = Date.now();
    const thresholdMs = 30 * 24 * 60 * 60 * 1000;
    const oldTimestamp = now - thresholdMs - 1000;

    // 1. Mock tool usage: toolA is unused and old (no workspace prefix on tool names)
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === DYNAMO_KEYS.TOOL_USAGE) {
        return {
          toolA: { count: 0, firstRegistered: oldTimestamp }, // tool names are simple
          toolB: { count: 5, firstRegistered: oldTimestamp }, // toolB is used
        };
      }
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
        return {
          'WS#default#agent1': { name: 'Agent 1', tools: [] },
        };
      }
      if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) {
        return {
          'WS#default#agent1': ['toolA', 'toolB'], // toolA in batch overrides
        };
      }
      if (key === 'WS#default#agent1_tools') {
        return ['toolA', 'toolC']; // toolA also in per-agent legacy list
      }
      return undefined;
    });

    const prunedCount = await AgentRegistry.pruneLowUtilizationTools('default', 30);

    // Should prune toolA (unused and old), keep toolB (used)
    expect(prunedCount).toBeGreaterThan(0);

    // VERIFY: Batch overrides are pruned ATOMICALLY via ConfigManager
    expect(ConfigManager.atomicRemoveFromMap).toHaveBeenCalledWith(
      DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
      'WS#default#agent1',
      ['toolA'],
      undefined
    );
  });

  it('should prune backbone agents when workspaceId is undefined', async () => {
    const now = Date.now();
    const thresholdMs = 30 * 24 * 60 * 60 * 1000;
    const oldTimestamp = now - thresholdMs - 1000;

    // 1. Mock: superclaw agent has unused toolA
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === DYNAMO_KEYS.TOOL_USAGE) {
        return {
          toolA: { count: 0, firstRegistered: oldTimestamp },
        };
      }
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
        return {
          // backbone agent without WS# prefix
          superclaw: { name: 'SuperClaw', tools: ['toolA', 'toolB'] },
        };
      }
      if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) {
        return {
          superclaw: ['toolA'], // toolA in overrides
        };
      }
      return undefined;
    });

    // Call without workspaceId - should prune backbone agents too
    const prunedCount = await AgentRegistry.pruneLowUtilizationTools(undefined, 30);

    expect(prunedCount).toBeGreaterThan(0);
    expect(ConfigManager.atomicRemoveFromMap).toHaveBeenCalledWith(
      DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
      'superclaw',
      ['toolA'],
      undefined
    );
  });

  it('should respect grace periods for newly assigned tools', async () => {
    const now = Date.now();

    // toolB was just registered (now) - should NOT be pruned even if unused
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === DYNAMO_KEYS.TOOL_USAGE) {
        return {
          toolB: { count: 0, firstRegistered: now },
        };
      }
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
        return {
          'WS#default#agent1': { name: 'Agent 1', tools: ['toolB'] },
        };
      }
      return undefined;
    });

    const prunedCount = await AgentRegistry.pruneLowUtilizationTools('default', 30);
    expect(prunedCount).toBe(0);
    expect(ConfigManager.saveRawConfig).not.toHaveBeenCalled();
  });
});
