import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionScheduler } from './evolution-scheduler';
import { EventType } from '../types/agent';
import { emitTypedEvent } from '../utils/typed-emit';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils/typed-emit', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue({ success: true }),
}));

describe('EvolutionScheduler', () => {
  let scheduler: EvolutionScheduler;
  let mockMemory: any;

  beforeEach(() => {
    vi.clearAllMocks();

    const items = new Map<string, any>();
    mockMemory = {
      items,
      putItem: vi.fn(async (item: any) => {
        console.log('STORAGE: putting', item.userId);
        items.set(item.userId, item);
      }),
      queryItems: vi.fn(async (params: any) => {
        const allItems = Array.from(items.values());
        console.log('STORAGE: querying with params', JSON.stringify(params));
        if (params.FilterExpression === '#status = :pending AND expiresAt <= :now') {
          const now = params.ExpressionAttributeValues[':now'];
          const filtered = allItems.filter(
            (item) => item.status === 'pending' && item.expiresAt <= now
          );
          console.log('STORAGE: found', filtered.length, 'items');
          return filtered;
        }
        return allItems;
      }),
    };

    scheduler = new EvolutionScheduler(mockMemory);
  });

  it('should schedule an action correctly', async () => {
    const actionId = await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'iam_change',
      reason: 'security upgrade',
      timeoutMs: 1000,
      traceId: 'trace-1',
    });

    expect(actionId).toBeDefined();
    expect(mockMemory.putItem).toHaveBeenCalled();

    const stored = mockMemory.items.get(`EVOLUTION#PENDING#${actionId}`);
    expect(stored.agentId).toBe('test-agent');
    expect(stored.status).toBe('pending');
  });

  it('should trigger timed out actions', async () => {
    // 1. Schedule an action in the past
    const actionId = await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'infra_topology',
      reason: 'optimization',
      timeoutMs: -100, // already expired
    });

    // 2. Trigger
    const count = await scheduler.triggerTimedOutActions();

    expect(count).toBe(1);
    expect(emitTypedEvent).toHaveBeenCalledWith(
      'evolution.scheduler',
      EventType.STRATEGIC_TIE_BREAK,
      expect.objectContaining({
        agentId: 'test-agent',
        metadata: expect.objectContaining({ actionId }),
      })
    );

    const updated = mockMemory.items.get(`EVOLUTION#PENDING#${actionId}`);
    expect(updated.status).toBe('triggered');
  });

  it('should not trigger actions that have not timed out', async () => {
    await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'iam_change',
      reason: 'future change',
      timeoutMs: 10000, // way in the future
    });

    const count = await scheduler.triggerTimedOutActions();
    expect(count).toBe(0);
    expect(emitTypedEvent).not.toHaveBeenCalled();
  });
});
