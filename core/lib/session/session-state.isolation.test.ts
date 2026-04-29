import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStateManager } from './session-state';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('SessionStateManager - Multi-Tenant Isolation', () => {
  let sessionStateManager: SessionStateManager;

  beforeEach(() => {
    ddbMock.reset();
    sessionStateManager = new SessionStateManager();
  });

  it('should use global PK when no workspaceId is provided', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sessionId: 's1', userId: 'SESSION_STATE#s1' } });

    await sessionStateManager.getState('s1');

    const call = ddbMock.call(0).args[0].input as any;
    expect(call.Key?.userId).toBe('SESSION_STATE#s1');
  });

  it('should use workspace-prefixed PK when workspaceId is provided', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sessionId: 's1', workspaceId: 'w1' } });

    await sessionStateManager.getState('s1', { workspaceId: 'w1' });

    const call = ddbMock.call(0).args[0].input as any;
    expect(call.Key?.userId).toBe('WS#w1#SESSION_STATE#s1');
  });

  it('should include teamId and staffId in prefix if provided', async () => {
    ddbMock.on(GetCommand).resolves({});

    await sessionStateManager.getState('s1', { workspaceId: 'w1', teamId: 't1', staffId: 'u1' });

    const call = ddbMock.call(0).args[0].input as any;
    // Format: WS#TEAM:t1#STAFF:u1#w1#SESSION_STATE#s1
    expect(call.Key?.userId).toBe('WS#TEAM:t1#STAFF:u1#w1#SESSION_STATE#s1');
  });

  it('should isolate acquireProcessing across workspaces', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    // Acquire in workspace 1
    await sessionStateManager.acquireProcessing('s1', 'agent-a', { workspaceId: 'w1' });
    const call1 = ddbMock.calls().find((c) => {
      const input = c.args[0].input as any;
      return input.UpdateExpression?.includes('processingAgentId');
    })?.args[0].input as any;

    // Acquire in workspace 2
    await sessionStateManager.acquireProcessing('s1', 'agent-b', { workspaceId: 'w2' });
    const call2 = ddbMock.calls().filter((c) => {
      const input = c.args[0].input as any;
      return input.UpdateExpression?.includes('processingAgentId');
    })[1]?.args[0].input as any;

    expect(call1?.Key?.userId).toBe('WS#w1#SESSION_STATE#s1');
    expect(call2?.Key?.userId).toBe('WS#w2#SESSION_STATE#s1');

    // Also verify the LOCK items themselves are isolated
    const lockCall1 = ddbMock.calls().find((c) => {
      const input = c.args[0].input as any;
      return input.UpdateExpression?.includes('lockType');
    })?.args[0].input as any;
    const lockCall2 = ddbMock.calls().filter((c) => {
      const input = c.args[0].input as any;
      return input.UpdateExpression?.includes('lockType');
    })[1]?.args[0].input as any;

    expect(lockCall1?.Key?.userId).toBe('WS#w1#LOCK#SESSION#s1');
    expect(lockCall2?.Key?.userId).toBe('WS#w2#LOCK#SESSION#s1');
  });
});
