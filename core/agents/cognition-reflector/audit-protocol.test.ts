import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit } from './audit-protocol';
import { ScytheLogic } from './lib/scythe';
import * as fs from 'fs';

vi.mock('./lib/scythe');
vi.mock('fs');
vi.mock('../../lib/logger');
vi.mock('../../lib/utils/bus');

describe('Audit Protocol - Scythe Silo', () => {
  let mockMemory: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getAllGaps: vi.fn().mockResolvedValue([]),
      getFailurePatterns: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue([]),
    };

    (vi.mocked(fs.existsSync) as any).mockReturnValue(true);
    (vi.mocked(fs.readdirSync) as any).mockReturnValue([]);
    (vi.mocked(fs.readFileSync) as any).mockReturnValue('');
    (vi.mocked(fs.statSync) as any).mockReturnValue({ isDirectory: () => false });
  });

  it('should identify per-agent bloat correctly', async () => {
    (ScytheLogic.generatePruneProposal as any).mockResolvedValue({
      swarm: {
        unusedTools: ['tool1'],
        zombieAgents: [],
        perAgentBloat: [
          {
            agentId: 'test-agent',
            unusedTools: ['tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tool6'],
          },
        ],
      },
      codebase: { emptyDirs: [], debtMarkers: 0, orphanedFiles: [] },
      thresholdDays: 30,
    });

    const report = await runSystemAudit(mockMemory, 'TEST');
    const scytheFindings = report.findings.filter((f) => f.silo === 'Scythe');

    expect(scytheFindings.some((f) => f.actual.includes('[Swarm Debt]'))).toBe(true);
  });

  it('should detect technical debt markers (TODO/FIXME)', async () => {
    (ScytheLogic.generatePruneProposal as any).mockResolvedValue({
      swarm: { unusedTools: [], zombieAgents: [], perAgentBloat: [] },
      codebase: { emptyDirs: [], debtMarkers: 30, orphanedFiles: [] },
      thresholdDays: 30,
    });

    const report = await runSystemAudit(mockMemory, 'TEST');
    const scytheFindings = report.findings.filter((f) => f.silo === 'Scythe');

    expect(scytheFindings.some((f) => f.actual.includes('[Codebase Debt]'))).toBe(true);
  });

  it('should detect empty directories', async () => {
    (ScytheLogic.generatePruneProposal as any).mockResolvedValue({
      swarm: { unusedTools: [], zombieAgents: [], perAgentBloat: [] },
      codebase: { emptyDirs: ['core/temp'], debtMarkers: 0, orphanedFiles: [] },
      thresholdDays: 30,
    });

    const report = await runSystemAudit(mockMemory, 'TEST');
    const scytheFindings = report.findings.filter((f) => f.silo === 'Scythe');

    expect(scytheFindings.some((f) => f.actual.includes('[Codebase Debt]'))).toBe(true);
  });
});
