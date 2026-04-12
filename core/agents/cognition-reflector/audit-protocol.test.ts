import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit } from './audit-protocol';
import { MetabolismService } from '../../lib/maintenance/metabolism';
import { setGap } from '../../lib/memory/gap-operations';

vi.mock('../../lib/maintenance/metabolism');
vi.mock('../../lib/memory/gap-operations');
vi.mock('../../lib/logger');
vi.mock('../../lib/utils/bus');

describe('Audit Protocol - Silo 7 (Regenerative Metabolism)', () => {
  let mockMemory: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getAllGaps: vi.fn().mockResolvedValue([]),
      getFailurePatterns: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue([]),
    };

    // Mock MetabolismService.runMetabolismAudit
    vi.mocked(MetabolismService.runMetabolismAudit).mockResolvedValue([
      {
        silo: 'Metabolism',
        expected: 'Lean, optimized system state',
        actual: 'Orphaned tool overrides detected',
        severity: 'P2',
        recommendation: 'Autonomous repair executed.',
      },
    ]);
  });

  it('should trigger regenerative metabolism during system audit', async () => {
    await runSystemAudit(mockMemory, 'SCHEDULED');

    expect(MetabolismService.runMetabolismAudit).toHaveBeenCalledWith(mockMemory, { repair: true });
  });

  it('should propagate P1/P2 findings as strategic maintenance gaps', async () => {
    // P2 finding already mocked in beforeEach
    await runSystemAudit(mockMemory, 'MANUAL');

    expect(setGap).toHaveBeenCalledWith(
      mockMemory,
      expect.stringContaining('MAINTENANCE-'),
      expect.stringContaining('Orphaned tool overrides detected'),
      expect.objectContaining({ urgency: 5, impact: 8 })
    );
  });

  it('should not propagate P3 findings as gaps', async () => {
    vi.mocked(MetabolismService.runMetabolismAudit).mockResolvedValue([
      {
        silo: 'Metabolism',
        expected: 'Clean code',
        actual: 'Minor TODO found',
        severity: 'P3',
        recommendation: 'Ignore for now',
      },
    ]);

    await runSystemAudit(mockMemory, 'MANUAL');

    expect(setGap).not.toHaveBeenCalled();
  });

  it('should aggregate findings into the final report', async () => {
    const report = await runSystemAudit(mockMemory, 'EVENT');

    expect(report.findings.some((f) => f.silo === 'Metabolism')).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
