/**
 * @module ExecutorHelper Tests
 * @description Tests for global pause checks, pending message injection,
 * timeout detection, cancellation, and formatting utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutorHelper } from './executor-helper';
import { AGENT_DEFAULTS, AGENT_LOG_MESSAGES } from './executor-types';
import { MessageRole } from '../types/index';

const mockGetRawConfig = vi.fn();
const mockGetPendingMessages = vi.fn();
const mockClearPendingMessages = vi.fn();
const mockRenewProcessing = vi.fn();
const mockIsTaskCancelled = vi.fn();

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../registry', () => ({
  AgentRegistry: { getRawConfig: (...args: unknown[]) => mockGetRawConfig(...args) },
}));

vi.mock('../constants', () => ({
  DYNAMO_KEYS: { GLOBAL_PAUSE: 'global_pause' },
}));

vi.mock('../session/session-state', () => ({
  SessionStateManager: vi.fn().mockImplementation(function (this: any) {
    this.getPendingMessages = (...args: unknown[]) => mockGetPendingMessages(...args);
    this.clearPendingMessages = (...args: unknown[]) => mockClearPendingMessages(...args);
    this.renewProcessing = (...args: unknown[]) => mockRenewProcessing(...args);
  }),
}));

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: (...args: unknown[]) => mockIsTaskCancelled(...args),
}));

describe('ExecutorHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkGlobalPause', () => {
    it('returns null when global pause is not active', async () => {
      mockGetRawConfig.mockResolvedValue(false);
      const result = await ExecutorHelper.checkGlobalPause();
      expect(result).toBeNull();
    });

    it('returns pause message when global pause is active', async () => {
      mockGetRawConfig.mockResolvedValue(true);
      const result = await ExecutorHelper.checkGlobalPause();
      expect(result).toContain('SYSTEM_PAUSED');
    });

    it('returns null and logs error when registry throws', async () => {
      mockGetRawConfig.mockRejectedValue(new Error('DDB down'));
      const result = await ExecutorHelper.checkGlobalPause();
      expect(result).toBeNull();
      const { logger } = await import('../logger');
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns null when config returns undefined', async () => {
      mockGetRawConfig.mockResolvedValue(undefined);
      const result = await ExecutorHelper.checkGlobalPause();
      expect(result).toBeNull();
    });
  });

  describe('injectPendingMessages', () => {
    const mockStateManager = {
      getPendingMessages: (...args: unknown[]) => mockGetPendingMessages(...args),
      clearPendingMessages: (...args: unknown[]) => mockClearPendingMessages(...args),
      renewProcessing: (...args: unknown[]) => mockRenewProcessing(...args),
    } as unknown as import('../session/session-state').SessionStateManager;

    it('returns original timestamp when no pending messages', async () => {
      mockGetPendingMessages.mockResolvedValue([]);
      const messages: import('../types/index').Message[] = [];
      const attachments: NonNullable<import('../types/index').Message['attachments']> = [];
      const result = await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        'session1',
        'agent1',
        1000,
        mockStateManager
      );
      expect(result).toBe(1000);
      expect(messages).toHaveLength(0);
    });

    it('injects new messages and returns max timestamp', async () => {
      mockGetPendingMessages.mockResolvedValue([
        { id: 'msg1', content: 'hello', timestamp: 2000, attachments: [] },
        { id: 'msg2', content: 'world', timestamp: 3000, attachments: [] },
      ]);
      mockClearPendingMessages.mockResolvedValue(undefined);
      const messages: import('../types/index').Message[] = [];
      const attachments: NonNullable<import('../types/index').Message['attachments']> = [];
      const result = await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        'session1',
        'agent1',
        1000,
        mockStateManager
      );
      expect(result).toBe(3000);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe(MessageRole.USER);
      expect(messages[0].content).toContain('hello');
      expect(messages[0].content).toContain('world');
    });

    it('filters messages by timestamp', async () => {
      mockGetPendingMessages.mockResolvedValue([
        { id: 'msg1', content: 'old', timestamp: 500, attachments: [] },
        { id: 'msg2', content: 'new', timestamp: 2000, attachments: [] },
      ]);
      mockClearPendingMessages.mockResolvedValue(undefined);
      const messages: import('../types/index').Message[] = [];
      const attachments: NonNullable<import('../types/index').Message['attachments']> = [];
      await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        'session1',
        'agent1',
        1000,
        mockStateManager
      );
      expect(messages[0].content).not.toContain('old');
      expect(messages[0].content).toContain('new');
    });

    it('collects attachments from pending messages', async () => {
      mockGetPendingMessages.mockResolvedValue([
        {
          id: 'msg1',
          content: 'with attachment',
          timestamp: 2000,
          attachments: [{ type: 'image', base64: 'abc' }],
        },
      ]);
      mockClearPendingMessages.mockResolvedValue(undefined);
      const messages: import('../types/index').Message[] = [];
      const attachments: NonNullable<import('../types/index').Message['attachments']> = [];
      await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        'session1',
        'agent1',
        1000,
        mockStateManager
      );
      expect(attachments).toHaveLength(1);
    });
  });

  describe('checkTimeouts', () => {
    it('returns null when no timeout conditions are met', () => {
      const result = ExecutorHelper.checkTimeouts(Date.now());
      expect(result).toBeNull();
    });

    it('detects Lambda timeout when remaining time is below buffer', () => {
      const context = {
        getRemainingTimeInMillis: () => AGENT_DEFAULTS.TIMEOUT_BUFFER_MS - 1000,
      } as unknown as import('aws-lambda').Context;
      const result = ExecutorHelper.checkTimeouts(Date.now(), undefined, 'pause', context);
      expect(result).not.toBeNull();
      expect(result!.paused).toBe(true);
      expect(result!.responseText).toBe(AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT);
    });

    it('returns null when Lambda has sufficient time', () => {
      const context = {
        getRemainingTimeInMillis: () => AGENT_DEFAULTS.TIMEOUT_BUFFER_MS + 10000,
      } as unknown as import('aws-lambda').Context;
      const result = ExecutorHelper.checkTimeouts(Date.now(), undefined, 'pause', context);
      expect(result).toBeNull();
    });

    it('detects custom task timeout with pause behavior', () => {
      const startTime = Date.now() - 10000;
      const result = ExecutorHelper.checkTimeouts(startTime, 5000, 'pause');
      expect(result).not.toBeNull();
      expect(result!.paused).toBe(true);
    });

    it('detects custom task timeout with fail behavior', () => {
      const startTime = Date.now() - 10000;
      const result = ExecutorHelper.checkTimeouts(startTime, 5000, 'fail');
      expect(result).not.toBeNull();
      expect(result!.responseText).toContain('TASK_FAILED');
    });

    it('returns null for continue behavior on timeout', () => {
      const startTime = Date.now() - 10000;
      const result = ExecutorHelper.checkTimeouts(startTime, 5000, 'continue');
      expect(result).toBeNull();
    });

    it('returns null when elapsed time is within timeout', () => {
      const startTime = Date.now() - 1000;
      const result = ExecutorHelper.checkTimeouts(startTime, 5000, 'pause');
      expect(result).toBeNull();
    });

    it('ignores context without getRemainingTimeInMillis', () => {
      const context = {} as unknown as import('aws-lambda').Context;
      const result = ExecutorHelper.checkTimeouts(Date.now(), undefined, 'pause', context);
      expect(result).toBeNull();
    });
  });

  describe('checkCancellation', () => {
    it('returns null when task is not cancelled', async () => {
      mockIsTaskCancelled.mockResolvedValue(false);
      const result = await ExecutorHelper.checkCancellation('task1');
      expect(result).toBeNull();
    });

    it('returns cancel message when task is cancelled', async () => {
      mockIsTaskCancelled.mockResolvedValue(true);
      const result = await ExecutorHelper.checkCancellation('task1');
      expect(result).toContain('TASK_CANCELLED');
    });

    it('returns null when cancellation check throws', async () => {
      mockIsTaskCancelled.mockRejectedValue(new Error('import failed'));
      const result = await ExecutorHelper.checkCancellation('task1');
      expect(result).toBeNull();
      const { logger } = await import('../logger');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('formatUserFriendlyResponse', () => {
    it('strips TASK_PAUSED prefix', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse('TASK_PAUSED: need more time');
      expect(result).toBe('need more time');
    });

    it('strips case-insensitive TASK_PAUSED prefix', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse('task_paused: some text');
      expect(result).toBe('some text');
    });

    it('strips Trace suffix', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse('done (Trace: abc123)');
      expect(result).toBe('done');
    });

    it('strips Trace suffix with trailing period', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse('done (Trace: abc123).');
      expect(result).toBe('done');
    });

    it('handles text without prefix or suffix', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse('clean text');
      expect(result).toBe('clean text');
    });

    it('handles both prefix and suffix', () => {
      const result = ExecutorHelper.formatUserFriendlyResponse(
        'TASK_PAUSED: work in progress (Trace: xyz).'
      );
      expect(result).toBe('work in progress');
    });
  });

  describe('formatApprovalMessage', () => {
    it('includes tool name and call ID', () => {
      const result = ExecutorHelper.formatApprovalMessage('deploy', 'call-123');
      expect(result).toContain('deploy');
      expect(result).toContain('call-123');
      expect(result).toContain('approval');
    });
  });
});
