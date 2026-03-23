import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenTracker } from './token-usage';
import { UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

describe('TokenTracker', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('updateRollup', () => {
    it('should use the correct partition key (TOKEN_ROLLUP#agentId)', async () => {
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
      expect(firstCall.input.Key?.timestamp).toBeGreaterThan(0);
    });

    it('should perform atomic average calculation in second pass', async () => {
      mockSend.mockResolvedValue({});

      await TokenTracker.updateRollup('test-agent', {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 1,
        success: true,
      });

      expect(mockSend).toHaveBeenCalledTimes(2);
      const secondCall = mockSend.mock.calls[1][0] as UpdateCommand;
      expect(secondCall.input.UpdateExpression).toBe(
        'SET avgTokensPerInvocation = (totalInputTokens + totalOutputTokens) / invocationCount'
      );
    });
  });

  describe('getRollupRange', () => {
    it('should query with the correct partition key prefix', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await TokenTracker.getRollupRange('test-agent', 7);

      expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.KeyConditionExpression).toBe(
        'userId = :pk AND timestamp BETWEEN :start AND :end'
      );
      expect(command.input.ExpressionAttributeValues?.[':pk']).toBe('TOKEN_ROLLUP#test-agent');
    });
  });
});
