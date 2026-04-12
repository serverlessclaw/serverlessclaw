import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BaseMemoryProvider } from '../base';
import { DynamoMemory } from '../dynamo-memory';
import { MessageRole } from '../../types/llm';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'TestMemoryTable',
    },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Workspace Isolation [Silo 4]', () => {
  let provider: BaseMemoryProvider;
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    provider = new BaseMemoryProvider(ddbMock as any);
    memory = new DynamoMemory(ddbMock as any);
  });

  describe('getScopedUserId', () => {
    it('should return userId as is when no workspaceId provided', () => {
      expect(provider.getScopedUserId('user-1')).toBe('user-1');
    });

    it('should prefix userId with workspaceId when provided', () => {
      expect(provider.getScopedUserId('user-1', 'ws-abc')).toBe('WS#ws-abc#user-1');
    });

    it('should not double-prefix if already prefixed', () => {
      expect(provider.getScopedUserId('WS#ws-abc#user-1', 'ws-abc')).toBe('WS#ws-abc#user-1');
    });
  });

  describe('Memory Isolation', () => {
    it('should use scoped PK when adding and getting messages', async () => {
      const userId = 'user-123';
      const workspaceId = 'ws-999';
      const scopedPk = `WS#${workspaceId}#${userId}`;

      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await memory.addMessage(
        userId,
        {
          role: MessageRole.USER,
          content: 'hello',
          traceId: 't1',
          messageId: 'm1',
        },
        workspaceId
      );

      // Verify PutCommand used scoped PK
      const putCall = ddbMock.call(0);
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          userId: scopedPk,
          workspaceId: workspaceId,
        },
      });

      await memory.getHistory(userId, workspaceId);

      // Verify QueryCommand used scoped PK
      const queryCall = ddbMock.call(1);
      expect(queryCall.args[0].input).toMatchObject({
        ExpressionAttributeValues: {
          ':userId': scopedPk,
        },
      });
    });

    it('should not interfere between different workspaces', async () => {
      const userId = 'user-123';

      ddbMock.on(QueryCommand).callsFake((params) => {
        const input = params.input || params;
        const pk = input.ExpressionAttributeValues[':userId'];
        if (pk === `WS#ws-1#${userId}`) {
          return {
            Items: [{ role: 'user', content: 'msg from ws-1', traceId: 't1', messageId: 'm1' }],
          };
        }
        if (pk === `WS#ws-2#${userId}`) {
          return {
            Items: [{ role: 'user', content: 'msg from ws-2', traceId: 't2', messageId: 'm2' }],
          };
        }
        return { Items: [] };
      });

      const history1 = await memory.getHistory(userId, 'ws-1');
      const history2 = await memory.getHistory(userId, 'ws-2');

      expect(history1[0].content).toBe('msg from ws-1');
      expect(history2[0].content).toBe('msg from ws-2');
    });
  });
});
