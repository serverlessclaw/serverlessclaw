import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsCollector } from './collector';
import { BaseMemoryProvider } from '../../memory/base';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let mockMemory: BaseMemoryProvider;

  beforeEach(() => {
    mockMemory = {
      putItem: vi.fn().mockResolvedValue({}),
      getItem: vi.fn(),
      deleteItem: vi.fn(),
      query: vi.fn(),
    } as unknown as BaseMemoryProvider;

    collector = new MetricsCollector(mockMemory, { enabled: true });
  });

  describe('recordTaskCompletion', () => {
    it('should push multiple metrics with unique timestamps to prevent overwrites', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'ws-123';

      await collector.recordTaskCompletion(agentId, true, 500, 100, {}, workspaceId);

      // Flush to verify
      await collector.flush();

      expect(mockMemory.putItem).toHaveBeenCalledTimes(3);

      const calls = (mockMemory.putItem as any).mock.calls;
      const ts1 = calls[0][0].timestamp;
      const ts2 = calls[1][0].timestamp;
      const ts3 = calls[2][0].timestamp;

      // Verify unique timestamps (fractions)
      expect(ts1).not.toBe(ts2);
      expect(ts2).not.toBe(ts3);
      expect(ts1).not.toBe(ts3);

      // Verify workspaceId propagation in key
      expect(calls[0][0].userId).toContain('WS#ws-123#');
    });

    it('should include workspaceId in the partitioned key', async () => {
      await collector.recordTaskCompletion('agent', true, 100, 50, {}, 'ws-456');
      await collector.flush();

      const call = (mockMemory.putItem as any).mock.calls[0][0];
      expect(call.userId).toContain('WS#ws-456#');
    });
  });

  describe('recordReasoningQuality', () => {
    it('should push reasoning metrics with unique timestamps', async () => {
      await collector.recordReasoningQuality('agent-1', 9.5, 3, true, false, 'ws-1');
      await collector.flush();

      expect(mockMemory.putItem).toHaveBeenCalledTimes(4);

      const calls = (mockMemory.putItem as any).mock.calls;
      const timestamps = calls.map((c: any) => c[0].timestamp);
      const uniqueTimestamps = new Set(timestamps);

      expect(uniqueTimestamps.size).toBe(4);
    });
  });
});
