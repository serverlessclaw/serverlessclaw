import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionMode } from '../../lib/types/agent';
import type { IMemory } from '../../lib/types/index';

/**
 * Evolution Module Tests
 *
 * Tests for getEvolutionMode, isGapInCooldown, and recordCooldown.
 */

// ============================================================================
// Mock Setup
// ============================================================================

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class MockGetCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        send: mockSend,
      }),
    },
    GetCommand: MockGetCommand,
  };
});

vi.mock('sst', () => ({
  Resource: { ConfigTable: { name: 'test-config-table' } },
}));

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn() },
}));

// ============================================================================
// Import after mocks
// ============================================================================

const { getEvolutionMode, COOLDOWN_TTL_MS, isGapInCooldown, recordCooldown } =
  await import('./evolution');

// ============================================================================
// Helpers
// ============================================================================

function createMemoryMock(): IMemory {
  return {
    getDistilledMemory: vi.fn().mockResolvedValue(null),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  } as unknown as IMemory;
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  mockSend.mockReset();
});

describe('COOLDOWN_TTL_MS', () => {
  it('is 6 hours (21600000 ms)', () => {
    expect(COOLDOWN_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(COOLDOWN_TTL_MS).toBe(21_600_000);
  });
});

describe('getEvolutionMode', () => {
  it('returns AUTO when DynamoDB returns AUTO', async () => {
    mockSend.mockResolvedValueOnce({ Item: { key: 'evolution_mode', value: EvolutionMode.AUTO } });
    const result = await getEvolutionMode();
    expect(result).toBe(EvolutionMode.AUTO);
  });

  it('returns HITL when DynamoDB returns HITL', async () => {
    mockSend.mockResolvedValueOnce({ Item: { key: 'evolution_mode', value: EvolutionMode.HITL } });
    const result = await getEvolutionMode();
    expect(result).toBe(EvolutionMode.HITL);
  });

  it('returns HITL when no item exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getEvolutionMode();
    expect(result).toBe(EvolutionMode.HITL);
  });

  it('returns HITL on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));
    const result = await getEvolutionMode();
    expect(result).toBe(EvolutionMode.HITL);
  });
});

describe('isGapInCooldown', () => {
  it('returns true when gap is in cooldown', async () => {
    const memory = createMemoryMock();
    const futureEntry = JSON.stringify([{ gapId: 'gap-1', expiresAt: Date.now() + 100_000 }]);
    vi.mocked(memory.getDistilledMemory).mockResolvedValueOnce(futureEntry);

    const result = await isGapInCooldown(memory, 'gap-1', 'user-1');
    expect(result).toBe(true);
    expect(memory.getDistilledMemory).toHaveBeenCalledWith('COOLDOWN_GAPS#user-1');
  });

  it('returns false when gap expired', async () => {
    const memory = createMemoryMock();
    const pastEntry = JSON.stringify([{ gapId: 'gap-1', expiresAt: Date.now() - 100_000 }]);
    vi.mocked(memory.getDistilledMemory).mockResolvedValueOnce(pastEntry);

    const result = await isGapInCooldown(memory, 'gap-1', 'user-1');
    expect(result).toBe(false);
  });

  it('returns false when gap not found in entries', async () => {
    const memory = createMemoryMock();
    const entries = JSON.stringify([{ gapId: 'gap-other', expiresAt: Date.now() + 100_000 }]);
    vi.mocked(memory.getDistilledMemory).mockResolvedValueOnce(entries);

    const result = await isGapInCooldown(memory, 'gap-1', 'user-1');
    expect(result).toBe(false);
  });

  it('returns false on error', async () => {
    const memory = createMemoryMock();
    vi.mocked(memory.getDistilledMemory).mockRejectedValueOnce(new Error('read fail'));

    const result = await isGapInCooldown(memory, 'gap-1', 'user-1');
    expect(result).toBe(false);
  });
});

describe('recordCooldown', () => {
  it('adds new entry and prunes expired', async () => {
    const memory = createMemoryMock();
    const now = Date.now();
    const existingEntries = JSON.stringify([
      { gapId: 'old-gap', expiresAt: now - 100_000 },
      { gapId: 'active-gap', expiresAt: now + 100_000 },
    ]);
    vi.mocked(memory.getDistilledMemory).mockResolvedValueOnce(existingEntries);

    await recordCooldown(memory, 'new-gap', 'user-1');

    const saved = vi.mocked(memory.updateDistilledMemory).mock.calls[0][1];
    const parsed = JSON.parse(saved);
    expect(parsed).toHaveLength(2);
    expect(parsed.find((e: { gapId: string }) => e.gapId === 'active-gap')).toBeTruthy();
    expect(parsed.find((e: { gapId: string }) => e.gapId === 'new-gap')).toBeTruthy();
    expect(parsed.find((e: { gapId: string }) => e.gapId === 'old-gap')).toBeFalsy();
    const newEntry = parsed.find((e: { gapId: string }) => e.gapId === 'new-gap');
    expect(newEntry.expiresAt).toBeGreaterThan(now);
    expect(newEntry.expiresAt).toBeLessThanOrEqual(now + COOLDOWN_TTL_MS + 1000);
  });

  it('handles empty existing entries', async () => {
    const memory = createMemoryMock();
    vi.mocked(memory.getDistilledMemory).mockResolvedValueOnce(null as unknown as string);

    await recordCooldown(memory, 'gap-1', 'user-1');

    const saved = vi.mocked(memory.updateDistilledMemory).mock.calls[0][1];
    const parsed = JSON.parse(saved);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].gapId).toBe('gap-1');
  });

  it('handles errors gracefully', async () => {
    const memory = createMemoryMock();
    vi.mocked(memory.getDistilledMemory).mockRejectedValueOnce(new Error('write fail'));

    await expect(recordCooldown(memory, 'gap-1', 'user-1')).resolves.toBeUndefined();
    expect(memory.updateDistilledMemory).not.toHaveBeenCalled();
  });
});
