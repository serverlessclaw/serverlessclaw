import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processReflectionReport } from './processor';
import { GapStatus } from '../../lib/types/index';

const mocks = vi.hoisted(() => ({
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  addLesson: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  updateGapMetadata: vi.fn().mockResolvedValue(undefined),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  queryItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: mocks.emitEvent,
}));

describe('Cognition Reflector Processor', () => {
  const mockMemory = {
    getDistilledMemory: vi.fn().mockResolvedValue('Old facts'),
    updateDistilledMemory: mocks.updateDistilledMemory,
    addLesson: mocks.addLesson,
    setGap: mocks.setGap,
    updateGapStatus: mocks.updateGapStatus,
    updateGapMetadata: mocks.updateGapMetadata,
    getAllGaps: vi.fn().mockResolvedValue([]),
    base: {
      queryItems: mocks.queryItems,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update facts if they changed', async () => {
    const report = {
      facts: 'New facts',
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');
    expect(mocks.updateDistilledMemory).toHaveBeenCalledWith('user-1', 'New facts');
  });

  it('should not update facts if they are the same', async () => {
    mockMemory.getDistilledMemory.mockResolvedValueOnce('Old facts');
    const report = {
      facts: 'Old facts',
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');
    expect(mocks.updateDistilledMemory).not.toHaveBeenCalled();
  });

  it('should add lessons', async () => {
    const report = {
      lessons: [{ content: 'Be careful with deletions', impact: 8 }],
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');
    expect(mocks.addLesson).toHaveBeenCalledWith(
      'user-1',
      'Be careful with deletions',
      expect.objectContaining({ impact: 8 })
    );
  });

  it('should create new strategic gaps and emit events', async () => {
    const report = {
      gaps: [{ content: 'Missing integration for X', impact: 9 }],
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');
    expect(mocks.setGap).toHaveBeenCalledWith(
      expect.any(String),
      'Missing integration for X',
      expect.objectContaining({ impact: 9 })
    );
    expect(mocks.emitEvent).toHaveBeenCalled();
  });

  it('should update existing gaps via semantic deduplication (direct query)', async () => {
    const gapId = 'GAP#1234567890';
    mocks.queryItems.mockResolvedValueOnce([
      {
        userId: gapId,
        content: 'Existing gap',
        metadata: { impact: 5, urgency: 3 },
        timestamp: 1234567890,
      },
    ]);

    const report = {
      updatedGaps: [{ id: '1234567890', impact: 8, urgency: 7 }],
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');

    expect(mocks.updateGapMetadata).toHaveBeenCalledWith(
      '1234567890',
      expect.objectContaining({ impact: 8, urgency: 7 })
    );
  });

  it('should update existing gaps via fallback to getAllGaps if direct query fails', async () => {
    mocks.queryItems.mockRejectedValueOnce(new Error('Query failed'));
    mockMemory.getAllGaps.mockResolvedValueOnce([
      { id: '1234567890', metadata: { impact: 5, urgency: 3 } },
    ]);

    const report = {
      updatedGaps: [{ id: '1234567890', impact: 8, urgency: 7 }],
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');

    expect(mocks.updateGapMetadata).toHaveBeenCalledWith(
      '1234567890',
      expect.objectContaining({ impact: 8, urgency: 7 })
    );
  });

  it('should resolve gaps', async () => {
    const report = {
      resolvedGapIds: ['gap-123'],
    };
    await processReflectionReport(report as any, mockMemory as any, 'user-1', 'user-1');
    expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-123', GapStatus.DONE);
  });
});
