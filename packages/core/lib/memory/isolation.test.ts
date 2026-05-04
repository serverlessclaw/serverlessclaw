import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from '../memory';
import { resolveItemById, atomicUpdateMetadata } from './utils';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Memory Isolation Safeguards', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('resolveItemById Isolation', () => {
    it('should strictly isolate GSI search by workspace prefix in FilterExpression', async () => {
      // Mock direct lookup failure
      ddbMock.on(QueryCommand).resolvesOnce({ Items: [] });

      // Mock GSI search
      await resolveItemById(memory, '42', 'GAP', 'WS1');

      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls.length).toBeGreaterThanOrEqual(2);

      // Verify second call (GSI) uses Workspace prefix in FilterExpression
      const gsiCall = queryCalls[1].args[0].input;
      expect(gsiCall.FilterExpression).toContain('begins_with(userId, :pkPrefix)');
      expect(gsiCall.FilterExpression).toContain('workspaceId = :workspaceId');
      expect(gsiCall.ExpressionAttributeValues?.[':pkPrefix']).toBe('WS#WS1#');
    });

    it('should fall back to raw user search if no workspaceId is provided', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Items: [] });

      await resolveItemById(memory, '42', 'GAP');

      const queryCalls = ddbMock.commandCalls(QueryCommand);
      const gsiCall = queryCalls[1].args[0].input;
      // Should find the global isolation check (attribute_not_exists)
      expect(gsiCall.FilterExpression).toContain('attribute_not_exists(workspaceId)');
    });

    it('should ignore injected items from other workspaces in GSI results', async () => {
      // Direct lookup fails
      ddbMock.on(QueryCommand).resolvesOnce({ Items: [] });

      // GSI returns an item from a DIFFERENT workspace
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'WS#OTHER_WS#GAP#42',
            timestamp: 123456789,
            type: 'GAP',
          },
        ],
      });

      // Attempt to resolve for WS1
      const result = await resolveItemById(memory, '42', 'GAP', 'WS1');

      // Should return null due to the manual workspaceId check in resolveItemById
      expect(result).toBeNull();
    });
  });

  describe('atomicUpdateMetadata Isolation', () => {
    it('should include ConditionExpression on userId to prevent cross-tenant overwrite', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await atomicUpdateMetadata(memory, 'GAP#42', 123456789, { impact: 10 }, 'WS1');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
      const input = updateCalls[0].args[0].input;

      // Key should be scoped
      expect(input.Key?.userId).toBe('WS#WS1#GAP#42');
      expect(input.ConditionExpression).toContain('attribute_exists(userId)');
    });

    it('should strip existing workspace prefix from userId to prevent spoofing', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      // Maliciously pre-scoped userId
      const maliciousUserId = 'WS#ATTACK#GAP#42';
      // Crucial: Pass the session's workspaceId as the 5th argument
      await atomicUpdateMetadata(memory, maliciousUserId, 123, { impact: 5 }, 'SECURE_WS');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const input = updateCalls[0].args[0].input;

      // Should be re-scoped to SECURE_WS, not ATTACK, because BaseMemoryProvider.getScopedUserId strips prefix
      expect(input.Key?.userId).toBe('WS#SECURE_WS#GAP#42');
    });
  });
});
