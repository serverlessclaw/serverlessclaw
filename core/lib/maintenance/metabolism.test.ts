import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetabolismService } from './metabolism';
import { AgentRegistry } from '../registry/AgentRegistry';
import { cullResolvedGaps, setGap } from '../memory/gap-operations';

vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    pruneLowUtilizationTools: vi.fn(),
  },
}));

vi.mock('../memory/gap-operations', () => ({
  archiveStaleGaps: vi.fn(),
  cullResolvedGaps: vi.fn(),
  setGap: vi.fn(),
}));

const { MockEvolutionScheduler } = vi.hoisted(() => ({
  MockEvolutionScheduler: class {
    scheduleAction = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock('../safety/evolution-scheduler', () => ({
  EvolutionScheduler: MockEvolutionScheduler,
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('MetabolismService', () => {
  const mockMemory = {};
  const mockFailurePayload: any = {
    userId: 'test-user',
    traceId: 'test-trace-id',
    agentId: 'test-agent',
    error: 'Test Error',
    source: 'dashboard',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('remediateDashboardFailure', () => {
    it('should execute tool pruning if the error is related to tools', async () => {
      const toolFailure = { ...mockFailurePayload, error: 'Failed to find tool: search' };
      (AgentRegistry.pruneLowUtilizationTools as any).mockResolvedValue(1);

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        toolFailure
      );

      expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith(0);
      expect(result).toBeDefined();
      expect(result?.actual).toContain('Pruned stale tool overrides');
    });

    it('should execute gap culling if the error is related to memory or gaps', async () => {
      const memoryFailure = { ...mockFailurePayload, error: 'Memory inconsistency in gap-123' };

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        memoryFailure
      );

      expect(cullResolvedGaps).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.actual).toContain('Culled resolved gaps');
    });

    it('should schedule an evolution and set a gap for complex errors', async () => {
      const complexFailure = { ...mockFailurePayload, error: 'Critical unhandled logic exception' };

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        complexFailure
      );

      expect(result).toBeUndefined();
      expect(setGap).toHaveBeenCalled();
    });
  });
});
