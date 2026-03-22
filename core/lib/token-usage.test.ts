import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: mockSend }),
    },
  };
});

import { TokenTracker } from './token-usage';

describe('TokenTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('recordInvocation', () => {
    it('should write a token usage record to MemoryTable', async () => {
      await TokenTracker.recordInvocation({
        timestamp: 1711000000000,
        traceId: 'trace-123',
        agentId: 'coder',
        provider: 'openai',
        model: 'gpt-5.4',
        inputTokens: 1500,
        outputTokens: 800,
        totalTokens: 2300,
        toolCalls: 3,
        taskType: 'agent_process',
        success: true,
        durationMs: 12000,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const item = mockSend.mock.calls[0][0].input.Item;
      expect(item.userId).toBe('TOKEN#coder#1711000000000');
      expect(item.inputTokens).toBe(1500);
      expect(item.outputTokens).toBe(800);
      expect(item.taskType).toBe('agent_process');
      expect(item.success).toBe(true);
      expect(item.expiresAt).toBeGreaterThan(0);
    });

    it('should not throw on DynamoDB failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('DDB down'));
      await expect(
        TokenTracker.recordInvocation({
          timestamp: 1,
          traceId: '',
          agentId: 'coder',
          provider: 'openai',
          model: 'gpt-5.4',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCalls: 0,
          taskType: 'agent_process',
          success: true,
          durationMs: 0,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('updateRollup', () => {
    it('should atomically update a daily rollup', async () => {
      await TokenTracker.updateRollup('coder', {
        inputTokens: 1000,
        outputTokens: 500,
        toolCalls: 2,
        success: true,
      });

      expect(mockSend).toHaveBeenCalled();
      const calls = mockSend.mock.calls as unknown[][];
      const updateCalls = calls.filter((c: any[]) =>
        JSON.stringify(c[0]?.input).includes('totalInputTokens')
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getRollup', () => {
    it('should return null when no rollup exists', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await TokenTracker.getRollup('coder', '2026-03-22');
      expect(result).toBeNull();
    });

    it('should return rollup data when it exists', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            userId: 'TOKEN_ROLLUP#coder#2026-03-22',
            timestamp: 1711000000000,
            totalInputTokens: 5000,
            totalOutputTokens: 2500,
            invocationCount: 10,
            toolCalls: 30,
            successCount: 9,
            avgTokensPerInvocation: 750,
          },
        ],
      });
      const result = await TokenTracker.getRollup('coder', '2026-03-22');
      expect(result).not.toBeNull();
      expect(result!.totalInputTokens).toBe(5000);
      expect(result!.invocationCount).toBe(10);
    });
  });

  describe('updateToolRollup', () => {
    it('should atomically update tool rollup with duration and tokens', async () => {
      await TokenTracker.updateToolRollup('fileRead', true, 500, 1000, 500);

      expect(mockSend).toHaveBeenCalled();

      const item = (mockSend.mock.calls[0] as any[])[0].input;
      expect(item.Key.userId).toMatch(/^TOOL_TOKEN#fileRead#/);
      expect(item.ExpressionAttributeValues[':dur']).toBe(500);
      expect(item.ExpressionAttributeValues[':inTok']).toBe(1000);
      expect(item.ExpressionAttributeValues[':outTok']).toBe(500);
    });
  });

  describe('getToolRollupRange', () => {
    it('should query for tool rollups in range', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            userId: 'TOOL_TOKEN#fileRead#2026-03-22',
            timestamp: Date.now(),
            invocationCount: 10,
            successCount: 9,
            totalDurationMs: 5000,
            totalInputTokens: 10000,
            totalOutputTokens: 5000,
          },
        ],
      });

      const results = await TokenTracker.getToolRollupRange('fileRead', 7);
      expect(results.length).toBe(1);
      expect(results[0].totalDurationMs).toBe(5000);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            KeyConditionExpression: 'userId = :pk AND timestamp BETWEEN :start AND :end',
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'TOOL_TOKEN#fileRead#',
            }),
          }),
        })
      );
    });
  });
});
