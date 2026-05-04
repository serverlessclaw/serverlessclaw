import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handler } from './maintenance';
import { TrustManager } from '../lib/safety/trust-manager';
import { AgentRegistry } from '../lib/registry/AgentRegistry';
import { PromotionManager } from '../lib/lifecycle/promotion-manager';

vi.mock('../lib/safety/trust-manager', () => ({
  TrustManager: {
    decayTrustScores: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAllConfigs: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../lib/lifecycle/promotion-manager', () => ({
  PromotionManager: {
    promoteAgentToAuto: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../lib/memory/workspace-operations', () => ({
  listWorkspaceIds: vi.fn().mockResolvedValue(['ws-1']),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../lib/safety/evolution-scheduler', () => ({
  EvolutionScheduler: vi.fn().mockImplementation(function () {
    return {
      triggerTimedOutActions: vi.fn().mockResolvedValue(0),
    };
  }),
}));

describe('maintenance handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run global and workspace trust decay', async () => {
    await handler({}, {} as any);

    expect(TrustManager.decayTrustScores).toHaveBeenCalledWith(); // Global
    expect(TrustManager.decayTrustScores).toHaveBeenCalledWith('ws-1'); // Workspace
  });

  it('should check for agent promotion in global and workspace', async () => {
    vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
      'agent-ws': { trustScore: 96, evolutionMode: 'HITL' } as any,
    }); // Workspace call (first in loop)
    vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
      'agent-global': { trustScore: 98, evolutionMode: 'HITL' } as any,
    }); // Global call (after loop)

    await handler({}, {} as any);

    expect(PromotionManager.promoteAgentToAuto).toHaveBeenCalledWith('agent-ws', 96, {
      workspaceId: 'ws-1',
    });
    expect(PromotionManager.promoteAgentToAuto).toHaveBeenCalledWith('agent-global', 98);
  });
});
