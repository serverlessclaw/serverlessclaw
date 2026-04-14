import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndPushRecursion, isMissionContext } from './shared';
import { getRecursionLimit } from '../../lib/recursion-tracker';
import { EventType } from '../../lib/types/agent';

// Mock recursion tracker
const mockDepth = { value: 0 };
vi.mock('../../lib/recursion-tracker', () => ({
  getRecursionDepth: vi.fn(async () => mockDepth.value),
  incrementRecursionDepth: vi.fn(async () => {
    mockDepth.value += 1;
    return mockDepth.value;
  }),
  getRecursionLimit: vi.fn(async (isMission) => (isMission ? 5 : 15)),
}));

// Mock ConfigManager
vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(async (_key, fallback) => fallback),
  },
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('EventHandler Shared Utilities', () => {
  beforeEach(() => {
    mockDepth.value = 0;
    vi.clearAllMocks();
  });

  describe('isMissionContext', () => {
    it('should return true for mission event types', () => {
      expect(isMissionContext(EventType.DAG_TASK_COMPLETED)).toBe(true);
      expect(isMissionContext(EventType.PARALLEL_TASK_DISPATCH)).toBe(true);
    });

    it('should return true if isMission flag is set in metadata', () => {
      expect(isMissionContext(EventType.TASK_COMPLETED, { isMission: true })).toBe(true);
    });

    it('should return false for standard events', () => {
      expect(isMissionContext(EventType.CODER_TASK)).toBe(false);
    });
  });

  describe('checkAndPushRecursion', () => {
    it('should correctly increment depth and push entry', async () => {
      const traceId = 'trace-1';
      const result = await checkAndPushRecursion(traceId, 'sess-1', 'agent-1');

      expect(result).toBe(1);
      expect(mockDepth.value).toBe(1);
    });

    it('should return null if recursion limit is exceeded', async () => {
      mockDepth.value = 15; // Limit is 15 by default, current depth starts at 15
      const traceId = 'trace-limit';
      const result = await checkAndPushRecursion(traceId, 'sess-1', 'agent-1');

      expect(result).toBeNull();
    });

    it('should use mission-specific limit when in mission context', async () => {
      // Mission limit is 5 by default
      mockDepth.value = 5;
      const traceId = 'trace-mission';
      const result = await checkAndPushRecursion(traceId, 'sess-1', 'agent-1', true);

      expect(result).toBeNull();
    });
  });

  describe('getRecursionLimit', () => {
    it('should return default limit when no config exists', async () => {
      const limit = await getRecursionLimit(false);
      expect(limit).toBe(15);
    });

    it('should return mission limit when requested', async () => {
      const limit = await getRecursionLimit(true);
      expect(limit).toBe(5);
    });
  });
});
