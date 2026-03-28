import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  ScanCommand: class {},
}));

describe('Collaboration API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns active dispatches on success', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            userId: 'PARALLEL#user-123#trace-abc',
            taskCount: 2,
            completedCount: 1,
            initiatorId: 'superclaw',
            sessionId: 'session-xyz',
            status: 'pending',
            metadata: {
              tasks: [
                { taskId: 'task-1', agentId: 'coder', task: 'Build feature' },
                { taskId: 'task-2', agentId: 'critic', task: 'Review code' },
              ],
            },
          },
        ],
      });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.activeDispatches).toHaveLength(1);
      expect(data.activeDispatches[0].traceId).toBe('trace-abc');
      expect(data.activeDispatches[0].taskCount).toBe(2);
      expect(data.activeDispatches[0].tasks).toHaveLength(2);
    });

    it('returns empty array when no items found', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(data.activeDispatches).toEqual([]);
    });

    it('returns empty array when table name is not available', async () => {
      vi.resetModules();
      vi.doMock('sst', () => ({
        Resource: {},
      }));
      vi.doMock('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: class {},
      }));
      vi.doMock('@aws-sdk/lib-dynamodb', () => ({
        DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
        ScanCommand: class {},
      }));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(data.activeDispatches).toEqual([]);
    });

    it('returns empty array on DynamoDB error', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(data.activeDispatches).toEqual([]);
    });

    it('maps DAG state to task status', async () => {
      vi.resetModules();
      vi.doMock('sst', () => ({
        Resource: { MemoryTable: { name: 'test-memory-table' } },
      }));
      vi.doMock('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: class {},
      }));
      vi.doMock('@aws-sdk/lib-dynamodb', () => ({
        DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
        ScanCommand: class {},
      }));

      mockSend.mockResolvedValue({
        Items: [
          {
            userId: 'PARALLEL#user-123#trace-dag',
            status: 'pending',
            taskCount: 2,
            completedCount: 1,
            initiatorId: 'superclaw',
            metadata: {
              tasks: [
                { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
                { taskId: 'task-2', agentId: 'critic', task: 'Review', dependsOn: ['task-1'] },
              ],
              dagState: {
                nodes: {
                  'task-1': { status: 'completed', task: { taskId: 'task-1', agentId: 'coder', task: 'Build' } },
                  'task-2': { status: 'ready', task: { taskId: 'task-2', agentId: 'critic', task: 'Review' } },
                },
                completedTasks: ['task-1'],
                failedTasks: [],
              },
            },
          },
        ],
      });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(data.activeDispatches[0].tasks[0].status).toBe('completed');
      expect(data.activeDispatches[0].tasks[1].status).toBe('ready');
      expect(data.activeDispatches[0].dagState).toBeDefined();
    });
  });
});
