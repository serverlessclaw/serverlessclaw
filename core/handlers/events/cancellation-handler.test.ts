import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => ({
        name: `test-${String(prop).toLowerCase()}`,
        value: 'test-value',
      }),
    }
  ),
}));

// 2. Mock DynamoDB
const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(function () {
      return { send: mockDdbSend };
    }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  QueryCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 3. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 4. Mock bus
const { mockEmitEvent } = vi.hoisted(() => ({
  mockEmitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: mockEmitEvent,
  EventPriority: {
    HIGH: 'HIGH',
  },
}));

// 5. Mock types
vi.mock('../../lib/types/agent', () => ({
  EventType: {
    TASK_CANCELLED: 'TASK_CANCELLED',
  },
}));

// 6. Import code to test
import { handleTaskCancellation, isTaskCancelled } from './cancellation-handler';

describe('cancellation-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
  });

  describe('handleTaskCancellation', () => {
    it('should set cancellation flag for single task', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          taskId: 'task-123',
          initiatorId: 'superclaw',
          reason: 'User requested cancellation',
        },
      } as any;

      await handleTaskCancellation(event);

      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-memorytable',
            Item: expect.objectContaining({
              userId: 'CANCEL#task-123',
              type: 'TASK_CANCELLATION',
              initiatorId: 'superclaw',
              reason: 'User requested cancellation',
            }),
          }),
        })
      );
    });

    it('should use default reason when not provided', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          taskId: 'task-123',
          initiatorId: 'superclaw',
        },
      } as any;

      await handleTaskCancellation(event);

      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Item: expect.objectContaining({
              reason: 'No reason provided',
            }),
          }),
        })
      );
    });

    it('should handle parallel cancellation when parallelDispatchId provided', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          userId: 'user-123',
          parallelDispatchId: 'dispatch-456',
          initiatorId: 'superclaw',
          reason: 'Cancel all parallel tasks',
        },
      } as any;

      // Mock parallel dispatch state
      mockDdbSend.mockResolvedValueOnce({
        Items: [
          {
            taskMapping: [
              { taskId: 'task-1', agentId: 'coder' },
              { taskId: 'task-2', agentId: 'qa' },
            ],
          },
        ],
      });

      await handleTaskCancellation(event);

      // Should query for parallel dispatch state
      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            KeyConditionExpression: 'userId = :uid AND timestamp = :ts',
          }),
        })
      );

      // Should emit cancellation events for each task
      expect(mockEmitEvent).toHaveBeenCalledTimes(2);
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent.cancellation',
        'TASK_CANCELLED',
        expect.objectContaining({
          userId: 'user-123',
          taskId: 'task-1',
          agentId: 'coder',
        }),
        expect.objectContaining({ priority: 'HIGH' })
      );
    });

    it('should warn when required fields are missing', async () => {
      const { logger } = await import('../../lib/logger');

      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          reason: 'Some reason',
        },
      } as any;

      await handleTaskCancellation(event);

      expect(logger.warn).toHaveBeenCalledWith(
        'Task cancellation received with missing required fields'
      );
    });

    it('should use default initiatorId for parallel tasks when not provided', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          userId: 'user-123',
          parallelDispatchId: 'dispatch-456',
        },
      } as any;

      mockDdbSend.mockResolvedValueOnce({
        Items: [
          {
            taskMapping: [{ taskId: 'task-1', agentId: 'coder' }],
          },
        ],
      });

      await handleTaskCancellation(event);

      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Item: expect.objectContaining({
              userId: 'CANCEL#task-1',
              initiatorId: 'parallel-dispatcher',
            }),
          }),
        })
      );
    });

    it('should handle missing parallel dispatch state gracefully', async () => {
      const { logger } = await import('../../lib/logger');

      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          userId: 'user-123',
          parallelDispatchId: 'dispatch-nonexistent',
        },
      } as any;

      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      await handleTaskCancellation(event);

      expect(logger.warn).toHaveBeenCalledWith(
        'No parallel dispatch state found for dispatch-nonexistent'
      );
    });

    it('should throw error when parallel cancellation fails', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          userId: 'user-123',
          parallelDispatchId: 'dispatch-456',
        },
      } as any;

      mockDdbSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(handleTaskCancellation(event)).rejects.toThrow('DynamoDB error');
    });

    it('should set expiration time on cancellation flag', async () => {
      const event = {
        'detail-type': 'TaskCancellation',
        detail: {
          taskId: 'task-123',
          initiatorId: 'superclaw',
        },
      } as any;

      await handleTaskCancellation(event);

      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Item: expect.objectContaining({
              expiresAt: expect.any(Number),
            }),
          }),
        })
      );
    });
  });

  describe('isTaskCancelled', () => {
    it('should return true when cancellation flag exists', async () => {
      mockDdbSend.mockResolvedValueOnce({
        Items: [{ userId: 'CANCEL#task-123', type: 'TASK_CANCELLATION' }],
      });

      const result = await isTaskCancelled('task-123');

      expect(result).toBe(true);
      expect(mockDdbSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-memorytable',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
              ':uid': 'CANCEL#task-123',
            },
          }),
        })
      );
    });

    it('should return false when no cancellation flag exists', async () => {
      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      const result = await isTaskCancelled('task-123');

      expect(result).toBe(false);
    });

    it('should return false on DynamoDB error', async () => {
      mockDdbSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const result = await isTaskCancelled('task-123');

      expect(result).toBe(false);
    });
  });
});
