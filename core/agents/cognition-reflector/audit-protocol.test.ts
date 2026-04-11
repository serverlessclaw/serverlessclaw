import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit, AUDIT_SILOS } from './audit-protocol';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// Minimal mock memory satisfying all audit function signatures
function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    getAllGaps: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockImplementation(async (key: string) => overrides[key] ?? null),
  };
}

describe('AUDIT_SILOS', () => {
  it('defines all 7 silos matching AUDIT.md', () => {
    const names = AUDIT_SILOS.map((s) => s.name);
    expect(names).toEqual(['Spine', 'Hand', 'Shield', 'Brain', 'Eye', 'Scales', 'Scythe']);
  });

  it('every silo has perspective, angle, and keyConcepts', () => {
    for (const silo of AUDIT_SILOS) {
      expect(silo.perspective).toBeTruthy();
      expect(silo.angle).toBeTruthy();
      expect(silo.keyConcepts.length).toBeGreaterThan(0);
    }
  });
});

describe('runSystemAudit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a report with correct structure', async () => {
    const memory = makeMemory();
    const report = await runSystemAudit(memory, 'CODE_GROWTH');

    expect(report.auditId).toMatch(/^AUDIT-/);
    expect(report.triggerType).toBe('CODE_GROWTH');
    expect(Array.isArray(report.findings)).toBe(true);
    expect(Array.isArray(report.silosReviewed)).toBe(true);
    expect(report.silosReviewed).toHaveLength(7);
    expect(typeof report.summary).toBe('string');
  });

  it('saves the report to memory', async () => {
    const memory = makeMemory();
    await runSystemAudit(memory, 'EVENT_TRIGGER');
    expect(memory.set).toHaveBeenCalledWith(
      expect.stringMatching(/^audit:AUDIT-/),
      expect.objectContaining({ auditId: expect.any(String) })
    );
  });
});

describe('Scythe silo (auditScythe)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports P2 when a prune proposal is stale (>7 days PENDING_REVIEW)', async () => {
    const staleProposal = {
      unusedTools: ['toolA', 'toolB'],
      thresholdDays: 30,
      status: 'PENDING_REVIEW',
      id: 'prune_proposal_123',
      lastAudit: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    };

    const memory = makeMemory({ pending_prune_proposal: staleProposal });
    // Mock ConfigManager for auto_prune_enabled check inside auditScythe
    vi.doMock('../../lib/registry/config', () => ({
      ConfigManager: {
        getTypedConfig: vi.fn().mockResolvedValue(false),
      },
    }));

    const report = await runSystemAudit(memory, 'EVENT_TRIGGER');
    const scytheFinding = report.findings.find(
      (f) => f.silo === 'Scythe' && f.severity === 'P2' && f.actual.includes('pending for')
    );
    expect(scytheFinding).toBeDefined();
    expect(scytheFinding?.recommendation).toContain('Strategic Planner');
  });

  it('does not flag a fresh prune proposal (<7 days)', async () => {
    const freshProposal = {
      unusedTools: ['toolA'],
      thresholdDays: 30,
      status: 'PENDING_REVIEW',
      id: 'prune_proposal_456',
      lastAudit: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
    };

    const memory = makeMemory({ pending_prune_proposal: freshProposal });
    const report = await runSystemAudit(memory, 'EVENT_TRIGGER');

    const staleFinding = report.findings.find(
      (f) => f.silo === 'Scythe' && f.actual.includes('pending for')
    );
    expect(staleFinding).toBeUndefined();
  });

  it('reports P3 when tool registry growth rate exceeds 20%', async () => {
    const toolHistory = [
      { count: 50, timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000 },
      { count: 65, timestamp: Date.now() }, // +30% growth
    ];

    const memory = makeMemory({ 'scythe:tool_count_history': toolHistory });
    const report = await runSystemAudit(memory, 'TRUNK_SYNC');

    const growthFinding = report.findings.find(
      (f) => f.silo === 'Scythe' && f.actual.includes('grew')
    );
    expect(growthFinding).toBeDefined();
    expect(growthFinding?.severity).toBe('P2');
  });
});

describe('Scales silo (auditScales)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports P2 when TrustScore history is missing', async () => {
    const memory = makeMemory(); // no trust:score_history
    const report = await runSystemAudit(memory, 'TRUST_SCORE_DROP');

    const finding = report.findings.find(
      (f) => f.silo === 'Scales' && f.actual.includes('No TrustScore history')
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('P2');
    expect(finding?.recommendation).toContain('epoch');
  });

  it('reports P1 when mode-shift thrashing exceeds 4 crossings', async () => {
    // Alternates across the 95 threshold 5 times
    const trustHistory = [90, 96, 90, 96, 90, 96].map((score, i) => ({
      score,
      timestamp: Date.now() - (6 - i) * 3600000,
    }));

    const memory = makeMemory({ 'trust:score_history': trustHistory });
    const report = await runSystemAudit(memory, 'TRUST_SCORE_DROP');

    const thrashFinding = report.findings.find((f) => f.silo === 'Scales' && f.severity === 'P1');
    expect(thrashFinding).toBeDefined();
    expect(thrashFinding?.recommendation).toContain('hysteresis');
  });

  it('reports P2 when failures exist but no penalty log', async () => {
    const memory = makeMemory();
    memory.getFailurePatterns.mockResolvedValue([
      { content: 'some failure', category: 'TOOL_EXECUTION' },
    ]);
    // trust:penalty_log returns null by default

    const report = await runSystemAudit(memory, 'CODE_GROWTH');
    const penaltyFinding = report.findings.find(
      (f) => f.silo === 'Scales' && f.actual.includes('penalty log')
    );
    expect(penaltyFinding).toBeDefined();
    expect(penaltyFinding?.severity).toBe('P2');
  });
});
