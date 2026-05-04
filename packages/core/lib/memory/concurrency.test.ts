import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BaseMemoryProvider } from './base';
import { refineMemory } from './insight-operations';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'TestMemoryTable',
    },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Silo 4 Concurrency Hardening', () => {
  let provider: BaseMemoryProvider;

  beforeEach(() => {
    ddbMock.reset();
    provider = new BaseMemoryProvider(ddbMock as any);
  });

  describe('refineMemory (Atomic)', () => {
    it('should use atomic UpdateCommand instead of read-modify-write', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { userId: 'user123', timestamp: 1000, content: 'Updated' },
      });

      await refineMemory(provider, 'user123', 1000, 'New Content', {
        priority: 10,
      });

      // Verification:
      // 1. Should NOT call QueryCommand (RMW pattern removed)
      const queryCalls = ddbMock.calls().filter((c) => c.args[0] instanceof QueryCommand);
      expect(queryCalls).toHaveLength(0);

      // 2. Should call UpdateCommand once
      const updateCalls = ddbMock.calls().filter((c) => c.args[0] instanceof UpdateCommand);
      expect(updateCalls).toHaveLength(1);

      const updateInput = updateCalls[0].args[0].input;
      expect(updateInput).toMatchObject({
        TableName: 'TestMemoryTable',
        Key: { userId: 'user123', timestamp: 1000 },
        UpdateExpression: expect.stringContaining(
          'SET updatedAt = :now, metadata.#priority = :priority, #content = :content'
        ),
        ConditionExpression: 'attribute_exists(userId)', // Critical for Principle 13
      });
    });

    it('should handle high-concurrency refinement without data loss (Simulation)', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      // Simulate 10 concurrent refinement calls
      const refinements = Array.from({ length: 10 }).map((_, i) =>
        refineMemory(provider, 'user123', 1000, `Content ${i}`, {
          priority: i,
        })
      );

      await Promise.all(refinements);

      // All 10 should have fired independent atomic updates
      const updateCalls = ddbMock.calls().filter((c) => c.args[0] instanceof UpdateCommand);
      expect(updateCalls).toHaveLength(10);

      // Each update should have had the existence guard
      updateCalls.forEach((call) => {
        expect((call.args[0] as any).input.ConditionExpression).toBe('attribute_exists(userId)');
      });
    });
  });
});
