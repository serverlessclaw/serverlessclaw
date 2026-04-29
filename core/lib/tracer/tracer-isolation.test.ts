import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawTracer } from './tracer-implementation';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

// Mock ddb-client
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('../utils/ddb-client', () => ({
  getDocClient: () => ({ send: mockSend }),
  getTraceTableName: () => 'TraceTable',
  getMemoryTableName: () => 'MemoryTable',
}));

describe('ClawTracer Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTrace Isolation', () => {
    it('should return all items if no workspaceId is provided', async () => {
      const mockItems = [
        { traceId: 'trace-1', workspaceId: 'ws-1', nodeId: 'root' },
        { traceId: 'trace-1', workspaceId: 'ws-2', nodeId: 'node-1' }, // Theoretically shouldn't happen but testing filter
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await ClawTracer.getTrace('trace-1');

      expect(result).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    });

    it('should filter items by workspaceId if provided', async () => {
      const mockItems = [
        { traceId: 'trace-1', workspaceId: 'ws-1', nodeId: 'root' },
        { traceId: 'trace-1', workspaceId: 'ws-2', nodeId: 'node-1' },
        { traceId: 'trace-1', workspaceId: 'ws-1', nodeId: 'node-2' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await ClawTracer.getTrace('trace-1', 'ws-1');

      expect(result).toHaveLength(2);
      expect(result.every((item) => item.workspaceId === 'ws-1')).toBe(true);
    });

    it('should return empty array if no items match workspaceId', async () => {
      const mockItems = [{ traceId: 'trace-1', workspaceId: 'ws-2', nodeId: 'root' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await ClawTracer.getTrace('trace-1', 'ws-1');

      expect(result).toHaveLength(0);
    });
  });
});
