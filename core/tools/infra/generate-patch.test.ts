import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockGetAgentContext = vi.hoisted(() => vi.fn());

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/utils/agent-helpers')>();
  return {
    ...actual,
    getAgentContext: mockGetAgentContext,
  };
});

import { generatePatch } from './deployment';

describe('generatePatch Tool', () => {
  const mockMemory = {
    getHistory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory.getHistory.mockResolvedValue([
      { content: 'TYPE_CHECK_PASSED' },
      { content: 'UNIT_TESTS_PASSED' },
      { tool_calls: [{ function: { name: 'recallKnowledge' } }] },
    ]);
    mockGetAgentContext.mockResolvedValue({ memory: mockMemory });
    mockExecSync.mockReturnValue('diff --git a/file.ts b/file.ts\n+new line');
  });

  it('has correct tool definition', () => {
    expect(generatePatch.name).toBe('generatePatch');
    expect(generatePatch.description).toBeDefined();
    expect(generatePatch.parameters).toBeDefined();
  });

  it('returns patch string when git diff has changes', async () => {
    const result = await generatePatch.execute({ sessionId: 'session-1' });

    expect(result).toContain('PATCH_START');
    expect(result).toContain('PATCH_END');
    expect(result).toContain('diff --git a/file.ts');
  });

  it('returns NO_CHANGES when git diff is empty', async () => {
    mockExecSync.mockReturnValue('');

    const result = await generatePatch.execute({ sessionId: 'session-1' });

    expect(result).toContain('NO_CHANGES');
  });

  it('enforces DoD validation by default', async () => {
    mockMemory.getHistory.mockResolvedValue([]);

    const result = await generatePatch.execute({ sessionId: 'session-1' });

    expect(result).toContain('FAILED_DOD');
  });

  it('skips DoD validation when skipValidation is true', async () => {
    const result = await generatePatch.execute({
      sessionId: 'session-1',
      skipValidation: true,
    });

    expect(result).toContain('PATCH_START');
  });

  it('handles git errors gracefully', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = await generatePatch.execute({ sessionId: 'session-1' });

    expect(result).toContain('FAILED_TO_GENERATE_PATCH');
  });
});
