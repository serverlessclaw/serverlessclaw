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
    saveRawConfig: vi.fn(),
  },
  defaultDocClient: mockDocClient,
}));

describe('AgentRegistry Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch all configs with constant number of DB calls regardless of agent count', async () => {
    // Mock 10 dynamic agents
    const dynamicAgents: Record<string, any> = {};
    for (let i = 0; i < 10; i++) {
      dynamicAgents[`agent_${i}`] = { id: `agent_${i}`, name: `Agent ${i}`, enabled: true };
    }

    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
      if (key === DYNAMO_KEYS.AGENTS_CONFIG) return dynamicAgents;
      if (key === DYNAMO_KEYS.AGENT_TOOL_OVERRIDES) return {};
      return undefined;
    });

    await AgentRegistry.getAllConfigs();

    // Verification:
    // 1 call for AGENTS_CONFIG
    // Total should be small and NOT 10+
    const callCount = vi.mocked(ConfigManager.getRawConfig).mock.calls.length;

    // It should be exactly 2 (1 for agents, 1 for batch overrides)
    expect(callCount).toBeLessThan(5);
    expect(callCount).toBe(2);
  });
});
