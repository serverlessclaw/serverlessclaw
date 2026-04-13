import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import { ConfigManager } from './config';
import { DYNAMO_KEYS } from '../constants';

vi.mock('./config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn(),
  },
  defaultDocClient: {},
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AgentRegistry Pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prune tools from both per-agent config and batch overrides using per-agent stats', async () => {
    const now = Date.now();
    const thresholdMs = 30 * 24 * 60 * 60 * 1000;
    const oldTimestamp = now - thresholdMs - 1000;

    // 1. Mock per-agent tool usage: toolA is unused and old for agent1
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === 'tool_usage_agent1') {
        return {
          toolA: { count: 0, firstRegistered: oldTimestamp },
        };
      }
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
        return {
          agent1: { name: 'Agent 1', tools: [] },
        };
      }
      if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) {
        return {
          agent1: ['toolA'], // toolA in batch overrides
        };
      }
      if (key === 'agent1_tools') {
        return ['toolA']; // toolA also in per-agent overrides
      }
      return undefined;
    });

    const prunedCount = await AgentRegistry.pruneLowUtilizationTools(30);

    // Should prune from both
    expect(prunedCount).toBeGreaterThan(0);
    
    // Check per-agent save
    const saveCalls = vi.mocked(ConfigManager.saveRawConfig).mock.calls;
    const perAgentSave = saveCalls.find(call => call[0] === 'agent1_tools');
    expect(perAgentSave).toBeDefined();
    expect(perAgentSave![1]).not.toContain('toolA');
    
    // VERIFY FIX: It SHOULD call saveRawConfig for AGENT_TOOL_OVERRIDES
    const batchSave = saveCalls.find(call => call[0] === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES);
    expect(batchSave).toBeDefined();
    expect(batchSave![1].agent1).not.toContain('toolA');
  });

  it('should respect grace periods for newly assigned tools', async () => {
    const now = Date.now();
    
    // toolB was just registered (now)
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === 'tool_usage_agent1') {
        return {
          toolB: { count: 0, firstRegistered: now },
        };
      }
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) {
        return {
          agent1: { name: 'Agent 1', tools: ['toolB'] },
        };
      }
      return undefined;
    });

    const prunedCount = await AgentRegistry.pruneLowUtilizationTools(30);
    expect(prunedCount).toBe(0);
    expect(ConfigManager.saveRawConfig).not.toHaveBeenCalled();
  });
});
