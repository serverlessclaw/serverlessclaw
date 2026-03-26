import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/types/index', () => ({
  EventType: {
    CONTINUATION_TASK: 'continuation_task',
    OUTBOUND_MESSAGE: 'outbound_message',
  },
  CompletionEvent: {},
  FailureEvent: {},
  TraceSource: { SYSTEM: 'system' },
}));

vi.mock('../../lib/providers/utils', () => ({
  parseConfigInt: vi.fn((val: unknown, fallback: number) => {
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
  }),
}));

vi.mock('../../lib/constants', () => ({
  SYSTEM: { DEFAULT_RECURSION_LIMIT: 15 },
  DYNAMO_KEYS: { RECURSION_LIMIT: 'recursion_limit' },
}));

import { wakeupInitiator, getRecursionLimit, handleRecursionLimitExceeded } from './shared';
import { emitEvent } from '../../lib/utils/bus';
import { sendOutboundMessage } from '../../lib/outbound';
import { ConfigManager } from '../../lib/registry/config';

describe('shared event utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('wakeupInitiator', () => {
    it('should emit CONTINUATION_TASK event', async () => {
      await wakeupInitiator('user1', 'planner', 'review task', 'trace-1', 'sess-1', 0);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({
          userId: 'user1',
          agentId: 'planner',
          task: 'review task',
          traceId: 'trace-1',
          sessionId: 'sess-1',
          depth: 1,
        })
      );
    });

    it('should strip .agent suffix from initiatorId', async () => {
      await wakeupInitiator('user1', 'coder.agent', 'task', undefined, undefined, 0);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ agentId: 'coder' })
      );
    });

    it('should not emit if initiatorId is undefined', async () => {
      await wakeupInitiator('user1', undefined, 'task', undefined, undefined, 0);
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should not emit if task is empty', async () => {
      await wakeupInitiator('user1', 'planner', '', undefined, undefined, 0);
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should append USER_ALREADY_NOTIFIED marker when userNotified is true', async () => {
      await wakeupInitiator('user1', 'planner', 'task', undefined, undefined, 0, true);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({
          task: expect.stringContaining('USER_ALREADY_NOTIFIED: true'),
        })
      );
    });

    it('should increment depth', async () => {
      await wakeupInitiator('user1', 'planner', 'task', undefined, undefined, 5);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ depth: 6 })
      );
    });
  });

  describe('getRecursionLimit', () => {
    it('should return default limit when config not set', async () => {
      (ConfigManager.getRawConfig as any).mockResolvedValueOnce(undefined);
      const result = await getRecursionLimit();
      expect(result).toBe(15);
    });

    it('should return custom limit from config', async () => {
      (ConfigManager.getRawConfig as any).mockResolvedValueOnce(25);
      const result = await getRecursionLimit();
      expect(result).toBe(25);
    });

    it('should return default on error', async () => {
      (ConfigManager.getRawConfig as any).mockRejectedValueOnce(new Error('DB error'));
      const result = await getRecursionLimit();
      expect(result).toBe(15);
    });
  });

  describe('handleRecursionLimitExceeded', () => {
    it('should send outbound message with recursion warning', async () => {
      await handleRecursionLimitExceeded('user1', 'sess-1', 'test.handler', 'Too deep');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'test.handler',
        'user1',
        expect.stringContaining('Recursion Limit Exceeded'),
        undefined,
        'sess-1',
        'SuperClaw',
        undefined
      );
    });

    it('should include the reason in the message', async () => {
      await handleRecursionLimitExceeded('user1', undefined, 'handler', 'Max depth 15 reached');
      const call = (sendOutboundMessage as any).mock.calls[0];
      expect(call[2]).toContain('Max depth 15 reached');
    });
  });
});
