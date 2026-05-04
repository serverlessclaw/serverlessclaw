import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionScheduler } from './evolution-scheduler';
import { EventType } from '../types/agent';
import { emitTypedEvent } from '../utils/typed-emit';
import { logger } from '../logger';

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
    const mockSend = vi.fn(async (command: any) => {
      if (command.constructor.name === 'UpdateCommand') {
        const { Key, UpdateExpression, ExpressionAttributeValues, ConditionExpression } =
          command.input;
        const item = items.get(Key.userId);

        if (ConditionExpression === '#status = :pending' && item?.status !== 'pending') {
          const error = new Error('ConditionalCheckFailedException');
          (error as any).name = 'ConditionalCheckFailedException';
          throw error;
        }

        if (item) {
          if (UpdateExpression.includes(':triggered')) {
            item.status = 'triggered';
            item.triggeredAt = ExpressionAttributeValues[':now'];
          } else if (UpdateExpression.includes(':status')) {
            item.status = ExpressionAttributeValues[':status'];
            item.updatedAt = ExpressionAttributeValues[':now'];
          }
          items.set(Key.userId, item);
        }
        return { Attributes: item };
      }
      return {};
    });

    mockMemory = {
      items,
      putItem: vi.fn(async (item: any) => {
        logger.info('STORAGE: putting', item.userId);
        items.set(item.userId, item);
      }),
      getScopedUserId: vi.fn((pk: string, scope?: any) => {
        if (scope?.workspaceId) return `WS#${scope.workspaceId}#${pk}`;
        return pk;
      }),
      getTableName: vi.fn(() => 'test-table'),
      getDocClient: vi.fn(() => ({
        send: mockSend,
      })),
      queryItems: vi.fn(async (params: any) => {
        const allItems = Array.from(items.values());
        logger.info('STORAGE: querying with params', JSON.stringify(params));
        if (params.FilterExpression?.includes('#status = :pending AND expiresAt <= :now')) {
          const now = params.ExpressionAttributeValues[':now'];
          let filtered = allItems.filter(
            (item) => item.status === 'pending' && item.expiresAt <= now
          );
          if (params.ExpressionAttributeValues[':ws']) {
            filtered = filtered.filter(
              (item) => item.workspaceId === params.ExpressionAttributeValues[':ws']
            );
          }
          logger.info('STORAGE: found', filtered.length, 'items');
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
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(actionId).toBeDefined();
    expect(mockMemory.putItem).toHaveBeenCalled();

    const stored = Array.from(mockMemory.items.values()).find(
      (i: any) => i.actionId === actionId
    ) as any;
    expect(stored.agentId).toBe('test-agent');
    expect(stored.status).toBe('pending');
    expect(stored.workspaceId).toBe('ws-1');
  });

  it('should trigger timed out actions', async () => {
    // 1. Schedule an action in the past
    const actionId = await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'infra_topology',
      reason: 'optimization',
      timeoutMs: -100, // already expired
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    // 2. Trigger
    const count = await scheduler.triggerTimedOutActions('ws-1');

    expect(count).toBe(1);
    expect(emitTypedEvent).toHaveBeenCalledWith(
      'evolution.scheduler',
      EventType.STRATEGIC_TIE_BREAK,
      expect.objectContaining({
        agentId: 'test-agent',
        workspaceId: 'ws-1',
        metadata: expect.objectContaining({ actionId }),
      }),
      expect.objectContaining({ idempotencyKey: `eve-trigger:${actionId}` })
    );

    const updated = Array.from(mockMemory.items.values()).find(
      (i: any) => i.actionId === actionId
    ) as any;
    expect(updated.status).toBe('triggered');
  });

  it('should not trigger actions from different workspace', async () => {
    await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'iam_change',
      reason: 'wrong workspace',
      timeoutMs: -100,
      userId: 'user-1',
      workspaceId: 'ws-wrong',
    });

    const count = await scheduler.triggerTimedOutActions('ws-1');
    expect(count).toBe(0);
  });

  it('should not trigger actions that have not timed out', async () => {
    await scheduler.scheduleAction({
      agentId: 'test-agent',
      action: 'iam_change',
      reason: 'future change',
      timeoutMs: 10000, // way in the future
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    const count = await scheduler.triggerTimedOutActions('ws-1');
    expect(count).toBe(0);
    expect(emitTypedEvent).not.toHaveBeenCalled();
  });
});
