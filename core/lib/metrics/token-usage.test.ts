import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenTracker } from './token-usage';
import { PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'MemoryTable' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class {
      send = mockSend;
    },
  };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({
        send: (command: any) => mockSend(command),
      }),
    },
  };
});

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('TokenTracker', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('recordInvocation', () => {
    it('should store invocation record with correct userId format', async () => {
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.recordInvocation({
        timestamp: 1000,
        traceId: 'trace-1',
        agentId: 'agent-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        toolCalls: 2,
        taskType: 'agent_process',
        success: true,
        durationMs: 1000,
      });

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
      const cmd = mockSend.mock.calls[0][0] as PutCommand;
      expect(cmd.input.Item?.userId).toBe('TOKEN#agent-1');
      expect(cmd.input.Item?.inputTokens).toBe(100);
      expect(cmd.input.Item?.success).toBe(true);
      expect(cmd.input.TableName).toBe('MemoryTable');
    });

    it('should not throw on DynamoDB error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(
        TokenTracker.recordInvocation({
          timestamp: 1000,
          traceId: 'trace-1',
          agentId: 'agent-1',
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          toolCalls: 0,
          taskType: 'agent_process',
          success: false,
          durationMs: 500,
        })
      ).resolves.not.toThrow();
    });

    it('should set correct TTL', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.recordInvocation({
        timestamp: 1000,
        traceId: 'trace-1',
        agentId: 'agent-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        toolCalls: 0,
        taskType: 'summarization',
        success: true,
        durationMs: 200,
      });

      const cmd = mockSend.mock.calls[0][0] as PutCommand;
      const expectedExpires = Math.floor(now / 1000) + 7 * 86400;
      expect(cmd.input.Item?.expiresAt).toBe(expectedExpires);

      vi.restoreAllMocks();
    });
  });

  describe('getInvocationHistory', () => {
    it('should return items from query', async () => {
      const items = [
        { agentId: 'a1', inputTokens: 100 },
        { agentId: 'a1', inputTokens: 200 },
      ];
      mockSend.mockResolvedValueOnce({ Items: items });

      const result = await TokenTracker.getInvocationHistory('agent-1');

      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    });

    it('should use default limit of 20', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await TokenTracker.getInvocationHistory('agent-1');

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.Limit).toBe(20);
    });

    it('should use custom limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await TokenTracker.getInvocationHistory('agent-1', 50);

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.Limit).toBe(50);
    });

    it('should return empty array on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('query error'));

      const result = await TokenTracker.getInvocationHistory('agent-1');

      expect(result).toEqual([]);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await TokenTracker.getInvocationHistory('agent-1');

      expect(result).toEqual([]);
    });

    it('should scan forward false (newest first)', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await TokenTracker.getInvocationHistory('agent-1');

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.ScanIndexForward).toBe(false);
    });
  });

  describe('updateRollup', () => {
    it('should use correct partition key', async () => {
      mockSend.mockResolvedValue({});

      await TokenTracker.updateRollup('test-agent', {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 1,
        success: true,
      });

      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const firstCall = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(firstCall.input.Key?.userId).toBe('TOKEN_ROLLUP#test-agent');
    });

    it('should calculate average in second pass', async () => {
      mockSend
        .mockResolvedValueOnce({
          Attributes: {
            totalInputTokens: 100,
            totalOutputTokens: 50,
            invocationCount: 1,
          },
        })
        .mockResolvedValueOnce({});

      await TokenTracker.updateRollup('test-agent', {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 1,
        success: true,
      });

      expect(mockSend).toHaveBeenCalledTimes(2);
      const secondCall = mockSend.mock.calls[1][0] as UpdateCommand;
      expect(secondCall.input.UpdateExpression).toBe(
        'SET avgTokensPerInvocation = :avgTokens, avgDurationMs = :avgDur, p50DurationMs = :p50, p95DurationMs = :p95, p99DurationMs = :p99, durationSamples = :samples'
      );
      expect(secondCall.input.ExpressionAttributeValues?.[':avgTokens']).toBe(150);
    });

    it('should skip second pass when invocationCount is 0', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          invocationCount: 0,
        },
      });

      await TokenTracker.updateRollup('test-agent', {
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        success: false,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should skip second pass when no Attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.updateRollup('test-agent', {
        inputTokens: 50,
        outputTokens: 25,
        toolCalls: 1,
        success: true,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should not throw on ConditionalCheckFailedException', async () => {
      const err = new Error('cond failed');
      err.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);

      await expect(
        TokenTracker.updateRollup('agent', {
          inputTokens: 100,
          outputTokens: 50,
          toolCalls: 0,
          success: true,
        })
      ).resolves.not.toThrow();
    });

    it('should not throw on other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network error'));

      await expect(
        TokenTracker.updateRollup('agent', {
          inputTokens: 100,
          outputTokens: 50,
          toolCalls: 0,
          success: true,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('getRollup', () => {
    it('should query with default date (today)', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ userId: 'TOKEN_ROLLUP#agent-1' }] });

      const result = await TokenTracker.getRollup('agent-1');

      expect(result).toEqual({ userId: 'TOKEN_ROLLUP#agent-1' });
    });

    it('should query with specific date', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ userId: 'TOKEN_ROLLUP#agent-1' }] });

      await TokenTracker.getRollup('agent-1', '2026-01-15');

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues?.[':pk']).toBe('TOKEN_ROLLUP#agent-1');
    });

    it('should return null when no items found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await TokenTracker.getRollup('agent-1');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('error'));

      const result = await TokenTracker.getRollup('agent-1');

      expect(result).toBeNull();
    });
  });

  describe('getRollupRange', () => {
    it('should query with correct key prefix', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await TokenTracker.getRollupRange('test-agent', 7);

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues?.[':pk']).toBe('TOKEN_ROLLUP#test-agent');
    });

    it('should return empty array on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('error'));

      const result = await TokenTracker.getRollupRange('agent', 7);

      expect(result).toEqual([]);
    });

    it('should return items on success', async () => {
      const items = [{ userId: 'TOKEN_ROLLUP#agent', timestamp: 123 }];
      mockSend.mockResolvedValueOnce({ Items: items });

      const result = await TokenTracker.getRollupRange('agent', 7);

      expect(result).toEqual(items);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await TokenTracker.getRollupRange('agent', 7);

      expect(result).toEqual([]);
    });
  });

  describe('updateToolRollup', () => {
    it('should update with correct key format', async () => {
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.updateToolRollup('web_search', true, 500, 100, 50);

      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const cmd = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(cmd.input.Key?.userId).toMatch(/^TOOL_TOKEN#web_search#/);
    });

    it('should use default values when optional params omitted', async () => {
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.updateToolRollup('web_search', false);

      const cmd = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(cmd.input.ExpressionAttributeValues?.[':dur']).toBe(0);
      expect(cmd.input.ExpressionAttributeValues?.[':inTok']).toBe(0);
      expect(cmd.input.ExpressionAttributeValues?.[':outTok']).toBe(0);
      expect(cmd.input.ExpressionAttributeValues?.[':success']).toBe(0);
    });

    it('should set success count to 1 for successful calls', async () => {
      mockSend.mockResolvedValueOnce({});

      await TokenTracker.updateToolRollup('web_search', true, 100);

      const cmd = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(cmd.input.ExpressionAttributeValues?.[':success']).toBe(1);
    });

    it('should not throw on DynamoDB error', async () => {
      mockSend.mockRejectedValueOnce(new Error('ddb error'));

      await expect(TokenTracker.updateToolRollup('web_search', true)).resolves.not.toThrow();
    });
  });

  describe('getToolRollupRange', () => {
    it('should query with correct key prefix', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await TokenTracker.getToolRollupRange('web_search', 7);

      const cmd = mockSend.mock.calls[0][0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues?.[':pk']).toMatch(/^TOOL_TOKEN#web_search#/);
    });

    it('should return empty array on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('error'));

      const result = await TokenTracker.getToolRollupRange('web_search', 7);

      expect(result).toEqual([]);
    });

    it('should return items on success', async () => {
      const items = [{ invocationCount: 5 }];
      mockSend.mockResolvedValueOnce({ Items: items });

      const result = await TokenTracker.getToolRollupRange('web_search', 7);

      expect(result).toEqual(items);
    });
  });
});
