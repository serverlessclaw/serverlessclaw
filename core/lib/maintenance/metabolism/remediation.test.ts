import { describe, it, expect, vi, beforeEach } from 'vitest';
import { remediateDashboardFailure } from './remediation';
import { BaseMemoryProvider } from '../../memory/base';
import { ConfigManager } from '../../registry/config';
import { AgentRegistry } from '../../registry/AgentRegistry';
import { cullResolvedGaps, setGap } from '../../memory/gap-operations';
import { EvolutionScheduler } from '../../safety/evolution-scheduler';

vi.mock('../../logger');
vi.mock('../../registry/config');
vi.mock('../../registry/AgentRegistry');
vi.mock('../../memory/gap-operations');
vi.mock('../../safety/evolution-scheduler');
vi.mock('../../utils/resource-helpers', () => ({
  getStagingBucketName: vi.fn(() => 'test-bucket'),
}));
vi.mock('./repairs', () => ({
  pruneStagingBucket: vi.fn(),
}));

describe('remediateDashboardFailure', () => {
  let mockMemory: BaseMemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      searchInsights: vi.fn(),
      addMemory: vi.fn(),
    } as unknown as BaseMemoryProvider;
  });

  it('should skip remediation if workspaceId is missing', async () => {
    const failure = {
      traceId: 'trace-1',
      error: 'Some error',
    } as any;

    const result = await remediateDashboardFailure(mockMemory, failure);
    expect(result).toBeUndefined();
  });

  it('should surgically prune a failing tool', async () => {
    const failure = {
      traceId: 'trace-1',
      workspaceId: 'ws-1',
      agentId: 'coder',
      error: 'Failed to execute tool "filesystem_write_file"',
    } as any;

    const result = await remediateDashboardFailure(mockMemory, failure);

    expect(ConfigManager.atomicRemoveFromMap).toHaveBeenCalledWith(
      expect.any(String),
      'coder',
      ['filesystem_write_file'],
      { workspaceId: 'ws-1' }
    );
    expect(result).toBeDefined();
    expect(result?.silo).toBe('Metabolism');
    expect(result?.actual).toContain('Pruned stale/failing tool');
  });

  it('should fall back to broad pruning if surgical pruning fails to identify a tool', async () => {
    const failure = {
      traceId: 'trace-1',
      workspaceId: 'ws-1',
      agentId: 'coder',
      error: 'Tool registry inconsistency detected',
    } as any;

    vi.mocked(AgentRegistry.pruneLowUtilizationTools).mockResolvedValue(1);

    const result = await remediateDashboardFailure(mockMemory, failure);

    expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith('ws-1', 1);
    expect(result).toBeDefined();
  });

  it('should remediate S3 errors by pruning staging bucket', async () => {
    const failure = {
      traceId: 'trace-1',
      workspaceId: 'ws-1',
      error: 'S3 Access Denied on artifact',
    } as any;

    const { pruneStagingBucket } = await import('./repairs');
    vi.mocked(pruneStagingBucket).mockResolvedValue(5);

    const result = await remediateDashboardFailure(mockMemory, failure);

    expect(pruneStagingBucket).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    expect(result?.actual).toContain('Metabolized staging bucket');
  });

  it('should remediate memory errors by culling resolved gaps', async () => {
    const failure = {
      traceId: 'trace-1',
      workspaceId: 'ws-1',
      error: 'Memory gap inconsistency',
    } as any;

    const result = await remediateDashboardFailure(mockMemory, failure);

    expect(cullResolvedGaps).toHaveBeenCalled();
    expect(result?.actual).toContain('Culled resolved gaps');
  });

  it('should schedule HITL evolution for complex errors', async () => {
    const failure = {
      traceId: 'trace-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      agentId: 'coder',
      error: 'Unknown complex error that needs human help',
    } as any;

    const mockScheduleAction = vi.fn();
    vi.mocked(EvolutionScheduler).mockImplementation(function () {
      return {
        scheduleAction: mockScheduleAction,
      };
    } as any);

    const result = await remediateDashboardFailure(mockMemory, failure);

    expect(mockScheduleAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REMEDIATION',
        workspaceId: 'ws-1',
      })
    );
    expect(setGap).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
