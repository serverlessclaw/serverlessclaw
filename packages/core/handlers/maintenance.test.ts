import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handler } from './maintenance';
import { TrustManager } from '../lib/safety/trust-manager';

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

vi.mock('../lib/maintenance/metabolism', () => ({
  MetabolismService: {
    runMetabolismAudit: vi.fn().mockResolvedValue({}),
  },
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

  it('should delegate repairs to MetabolismService per-workspace', async () => {
    const { MetabolismService } = await import('../lib/maintenance/metabolism');

    await handler({}, {} as any);

    // One for workspace loop, one for global run at the end
    expect(MetabolismService.runMetabolismAudit).toHaveBeenCalledTimes(2);
    expect(MetabolismService.runMetabolismAudit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ workspaceId: 'ws-1', repair: true })
    );
    expect(MetabolismService.runMetabolismAudit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ repair: true })
    );
  });
});
